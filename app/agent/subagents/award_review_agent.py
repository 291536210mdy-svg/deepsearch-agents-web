"""
AI评优子智能体配置模块

将 app/prompt/prompts.yml 中的 award_review 配置与 run_award_review 工具组装成
DeepAgents 可识别的字典式子智能体。主智能体后续会根据 description
决定是否把评优 Excel 批处理任务分派给它。
"""

from app.agent.prompts import sub_agents_content
from app.tools.award_review_tool import run_award_review

# AI评优助手只处理用户上传的评优 Excel，不做网络搜索、数据库查询或 RAGFlow 查询。
# 工具会调用独立的评优批处理核心，并在当前会话目录生成 Excel/JSONL 等产物。
award_review_agent = {
    "name": sub_agents_content["award_review"]["name"],
    "description": sub_agents_content["award_review"]["description"],
    "system_prompt": sub_agents_content["award_review"]["system_prompt"],
    "tools": [run_award_review],
}
