# API Spec v0.2（Logical）

## 1. CRUD（Standard）
- tasks, milestones, wiki_pages, meetings via Supabase Client（RLS protected）

## 2. RPC（Business Logic）
- rpc_publish_milestone(id) / rpc_unpublish_milestone(id)
- rpc_publish_task(id) / rpc_unpublish_task(id)
- rpc_save_meeting_draft(id, json)

## 3. Edge Functions（LLM / AI）
These functions call the Gemini API.

### POST /functions/v1/llm-refine-task
- Purpose: Refine vague task descriptions into structured Markdown.
- Input: { "title": string, "raw_description": string }
- Output: { "refined_description": markdown_string, "suggested_acceptance_criteria": string[] }
- Logic: 15_LLM_System_Prompts.md > Task Refine

### POST /functions/v1/llm-extract-meeting
- Purpose: Extract tasks and decisions from meeting transcripts.
- Input: { "transcript_text": string, "project_context": string }
- Output: JSON Object (Decisions[], DiscussionItems[], TaskDrafts[])
- Logic: 15_LLM_System_Prompts.md > Meeting Extract
