"""
评优流程工具模块

封装 AI 评优批处理能力，供评优子智能体调用。工具从当前会话工作目录读取用户上传的
Excel，调用 app/award_review/review_batch.py 中的核心流程，并把结果产物写回当前会话目录。
"""

import json
import os
from pathlib import Path
from typing import Annotated

from dotenv import find_dotenv, load_dotenv
from langchain_core.tools import tool

from app.api.context import get_session_context
from app.api.monitor import monitor
from app.award_review import review_batch as rb
from app.utils.path_utils import resolve_path

load_dotenv(find_dotenv())

APP_ROOT = Path(__file__).parents[1].resolve()
AWARD_REVIEW_DIR = APP_ROOT / "award_review"
DEFAULT_TEMPLATE_PATH = AWARD_REVIEW_DIR / "评选结果输出格式.xlsx"
DEFAULT_AWARD_CONFIG_PATH = AWARD_REVIEW_DIR / "award_config.json"
DEFAULT_RULES_PATH = AWARD_REVIEW_DIR / "2025年度评优规则_知识库版.md"
DEFAULT_PREFLIGHT_TIMEOUT = 20


def _resolve_session_file(filename: str) -> Path:
    """
    将模型传入的文件名解析到当前会话目录，并拒绝读取会话目录外的文件。
    """
    session_dir = get_session_context()
    if not session_dir:
        raise ValueError("当前没有可用的 session_dir，无法定位上传文件。")

    session_path = Path(session_dir).resolve()
    file_path = Path(resolve_path(filename, session_dir)).resolve()

    if not file_path.exists():
        raise FileNotFoundError(f"文件不存在：{filename}")

    if file_path.suffix.lower() != ".xlsx":
        raise ValueError("评优工具只接受 .xlsx 文件。")

    if not file_path.is_relative_to(session_path):
        raise ValueError("只能处理当前会话工作目录内的 Excel 文件。")

    return file_path


def _artifact_info(path: Path, session_path: Path) -> dict:
    return {
        "name": path.name,
        "path": str(path),
        "relative_path": str(path.relative_to(session_path)).replace("\\", "/"),
        "size_bytes": path.stat().st_size if path.exists() else 0,
    }


def _read_internal_pack_summary(path: Path, max_candidates: int = 20) -> list[dict]:
    """
    从 internal_review_pack_*.jsonl 中提取轻量候选摘要，避免把完整评审包塞回模型上下文。
    """
    if not path.exists():
        return []

    candidates = []
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            if len(candidates) >= max_candidates:
                break
            if not line.strip():
                continue

            item = json.loads(line)
            fields = item.get("final_result_fields", {})
            recommendation = item.get("recommendation", {})
            scoring = item.get("scoring", {})
            evidence = item.get("evidence", {})

            candidates.append(
                {
                    "candidate_id": item.get("candidate_id", ""),
                    "excel_row": item.get("excel_row"),
                    "award_name": item.get("award_name", ""),
                    "subject": fields.get("主体", ""),
                    "rank": recommendation.get("rank", ""),
                    "recommendation_status": recommendation.get("status", ""),
                    "manual_review_required": recommendation.get("manual_review_required", False),
                    "internal_score": scoring.get("internal_score"),
                    "normal_review_score": scoring.get("normal_review_score"),
                    "ranking_reason": recommendation.get("ranking_reason", ""),
                    "ranking_reason_source": recommendation.get("ranking_reason_source", ""),
                    "missing_evidence": evidence.get("missing_evidence", []),
                    "risk_flags": evidence.get("risk_flags", []),
                }
            )

    return candidates


class AwardReviewEventSink:
    """把 review_batch 的内部事件转成 deepsearch 的 monitor 事件。"""

    def emit(
        self,
        event_type: str,
        *,
        message: str = "",
        level: str = "info",
        progress: tuple[int, int] | None = None,
        payload: dict | None = None,
    ) -> None:
        monitor._emit(
            "tool_progress",
            message or event_type,
            {
                "tool_name": "AI评优批处理工具",
                "event_type": event_type,
                "level": level,
                "progress": {
                    "current": progress[0] if progress else None,
                    "total": progress[1] if progress else None,
                },
                "payload": payload or {},
            },
        )


def _gateway_preflight(config: rb.ReviewBatchConfig) -> None:
    if (config.model_backend or "gateway").strip().lower() != "gateway" or config.dry_run:
        return

    timeout = int(os.getenv("AWARD_REVIEW_PREFLIGHT_TIMEOUT", str(DEFAULT_PREFLIGHT_TIMEOUT)))
    messages = [
        {
            "role": "user",
            "content": '请只返回 {"ok": true}，不要输出其他内容。',
        }
    ]
    try:
        rb.call_gateway_chat(
            config,
            messages,
            min(timeout, config.timeout),
            max_tokens=32,
        )
    except Exception as exc:
        raise RuntimeError(
            "AI Gateway 预检失败：线上后端无法在 "
            f"{timeout} 秒内调用评优 chat 模型。请检查 Railway 是否能访问集团 AI 网关、"
            f"密钥和模型名。原始错误：{exc}"
        ) from exc


@tool
def run_award_review(
    filename: Annotated[str, "当前会话目录中的评优 Excel 文件名，必须是 .xlsx"],
) -> str:
    """
    对当前会话中上传的评优 Excel 执行全量 AI 评优批处理。

    适用场景：
    1. 用户上传评优提名汇总 Excel。
    2. 用户要求跑评优、生成候选排序或排名理由。
    3. 默认正式全量处理，不做 dry-run，不做 limit 限制，不生成 QA 报告。

    返回 JSON 字符串，包含候选摘要和生成产物路径。
    """
    monitor.report_tool(
        tool_name="AI评优批处理工具",
        args={"filename": filename, "mode": "full"},
    )

    session_dir = get_session_context()
    if not session_dir:
        return json.dumps(
            {"status": "failed", "error": "当前没有可用的 session_dir。"},
            ensure_ascii=False,
        )

    try:
        session_path = Path(session_dir).resolve()
        input_path = _resolve_session_file(filename)
        output_dir = session_path / "award_review"
        output_dir.mkdir(parents=True, exist_ok=True)

        config = rb.ReviewBatchConfig(
            input_path=input_path,
            output_dir=output_dir,
            template_path=DEFAULT_TEMPLATE_PATH,
            award_config_path=DEFAULT_AWARD_CONFIG_PATH,
            rules_path=DEFAULT_RULES_PATH,
            dry_run=False,
            limit=0,
            award_filters=[],
            generate_qa_report=False,
            enable_leadership_priority=True,
            model_backend=os.getenv("REVIEW_MODEL_BACKEND", "gateway"),
            gateway_chat_url=os.getenv("AI_GATEWAY_CHAT_URL", ""),
            gateway_chat_api_key=os.getenv("AI_GATEWAY_CHAT_API_KEY", ""),
            gateway_chat_model=os.getenv("AI_GATEWAY_CHAT_MODEL", "claude-sonnet-4.6"),
            gateway_embedding_url=os.getenv("AI_GATEWAY_EMBEDDING_URL", ""),
            gateway_embedding_api_key=os.getenv("AI_GATEWAY_EMBEDDING_API_KEY", ""),
            gateway_embedding_model=os.getenv("AI_GATEWAY_EMBEDDING_MODEL", "bge-m3"),
            gateway_rerank_url=os.getenv("AI_GATEWAY_RERANK_URL", ""),
            gateway_rerank_api_key=os.getenv("AI_GATEWAY_RERANK_API_KEY", ""),
            gateway_rerank_model=os.getenv("AI_GATEWAY_RERANK_MODEL", "bge-reranker-v2-m3"),
        )

        monitor._emit(
            "tool_progress",
            "正在预检 AI Gateway 连通性",
            {"tool_name": "AI评优批处理工具", "event_type": "gateway:preflight"},
        )
        _gateway_preflight(config)
        monitor._emit(
            "tool_progress",
            "AI Gateway 预检通过",
            {"tool_name": "AI评优批处理工具", "event_type": "gateway:preflight_done"},
        )

        result = rb.run_review_batch(config, event_sink=AwardReviewEventSink())

        artifacts = {
            "review_results_xlsx": _artifact_info(Path(result.xlsx_path), session_path),
            "raw_review_jsonl": _artifact_info(Path(result.raw_jsonl_path), session_path),
            "internal_review_pack": _artifact_info(Path(result.internal_pack_path), session_path),
            "completion_xlsx": _artifact_info(Path(result.completion_path), session_path),
        }

        response = {
            "status": "succeeded",
            "input_file": input_path.name,
            "output_dir": str(output_dir),
            "summary": {
                "expected_rows": result.expected_rows,
                "processed_rows": result.processed_rows,
                "award_counts": result.award_counts,
            },
            "artifacts": artifacts,
            "candidate_preview": _read_internal_pack_summary(
                Path(result.internal_pack_path),
                max_candidates=20,
            ),
            "message": "评优批处理已完成，结果文件已生成在当前会话目录的 award_review 子目录。",
        }

        monitor._emit(
            "tool_result",
            "AI评优批处理完成",
            {
                "tool_name": "AI评优批处理工具",
                "processed_rows": result.processed_rows,
                "artifacts": {key: value["relative_path"] for key, value in artifacts.items()},
            },
        )

        return json.dumps(response, ensure_ascii=False, indent=2)

    except Exception as exc:
        monitor._emit(
            "error",
            f"AI评优批处理失败：{str(exc)}",
            {"tool_name": "AI评优批处理工具"},
        )
        return json.dumps(
            {
                "status": "failed",
                "error": str(exc),
                "message": "评优批处理失败，请检查上传文件、环境变量和模型网关配置。",
            },
            ensure_ascii=False,
            indent=2,
        )


if __name__ == "__main__":
    print("请通过 DeepAgents 子智能体或 LangChain tool invoke 调用 run_award_review。")
