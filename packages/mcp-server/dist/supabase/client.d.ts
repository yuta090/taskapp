import { SupabaseClient } from '@supabase/supabase-js';
export declare function getSupabaseClient(): SupabaseClient;
export interface Task {
    id: string;
    org_id: string;
    space_id: string;
    milestone_id: string | null;
    title: string;
    description: string | null;
    status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'considering';
    priority: number | null;
    assignee_id: string | null;
    due_date: string | null;
    ball: 'client' | 'internal';
    origin: 'client' | 'internal';
    type: 'task' | 'spec';
    spec_path: string | null;
    decision_state: 'considering' | 'decided' | 'implemented' | null;
    client_scope: 'deliverable' | 'internal';
    parent_task_id: string | null;
    start_date: string | null;
    actual_hours: number | null;
    created_at: string;
    updated_at: string;
}
export interface TaskOwner {
    id: string;
    org_id: string;
    space_id: string;
    task_id: string;
    side: 'client' | 'internal';
    user_id: string;
    created_at: string;
}
export interface Meeting {
    id: string;
    org_id: string;
    space_id: string;
    title: string;
    held_at: string | null;
    notes: string | null;
    status: 'planned' | 'in_progress' | 'ended';
    started_at: string | null;
    ended_at: string | null;
    minutes_md: string | null;
    summary_subject: string | null;
    summary_body: string | null;
    created_at: string;
    updated_at: string;
}
export interface WikiPage {
    id: string;
    org_id: string;
    space_id: string;
    title: string;
    body: string;
    tags: string[];
    created_by: string;
    updated_by: string;
    created_at: string;
    updated_at: string;
}
export interface WikiPageVersion {
    id: string;
    org_id: string;
    page_id: string;
    title: string;
    body: string;
    created_by: string;
    created_at: string;
}
export interface Space {
    id: string;
    org_id: string;
    type: 'project' | 'personal';
    name: string;
    owner_user_id: string | null;
    created_at: string;
}
export interface Organization {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
}
export type BallSide = 'client' | 'internal';
export type TaskType = 'task' | 'spec';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'considering';
export type DecisionState = 'considering' | 'decided' | 'implemented';
export type ClientScope = 'deliverable' | 'internal';
//# sourceMappingURL=client.d.ts.map