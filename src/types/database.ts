/**
 * Database types for TaskApp (DDL v0.2)
 *
 * These types should be generated from Supabase CLI in production:
 * npx supabase gen types typescript --project-id <project-id> > src/types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Task status values
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'considering'

// Ball ownership
export type BallSide = 'client' | 'internal'

// Comment visibility
export type CommentVisibility = 'client' | 'internal'

// Task type
export type TaskType = 'task' | 'spec'

// Decision state for spec tasks
export type DecisionState = 'considering' | 'decided' | 'implemented'

// Client scope for portal visibility
export type ClientScope = 'deliverable' | 'internal'

// Meeting status
export type MeetingStatus = 'planned' | 'in_progress' | 'ended'

// Review status
export type ReviewStatus = 'open' | 'approved' | 'changes_requested'

// Review approval state
export type ApprovalState = 'pending' | 'approved' | 'blocked'

// Notification channel
export type NotificationChannel = 'in_app' | 'email'

// Task event actions (recommended values)
export type TaskEventAction =
  | 'TASK_CREATE'
  | 'TASK_UPDATE'
  | 'PASS_BALL'
  | 'SET_OWNERS'
  | 'CONSIDERING_DECIDE'
  | 'SPEC_DECIDE'
  | 'SPEC_IMPLEMENT'
  | 'REVIEW_OPEN'
  | 'REVIEW_APPROVE'
  | 'REVIEW_BLOCK'
  | 'MEETING_START'
  | 'MEETING_END'
  | string // Allow custom actions

// Evidence types for decisions
export type EvidenceType = 'meeting' | 'chat' | 'email' | 'call' | 'other'

// Org membership role
export type OrgRole = 'owner' | 'member' | 'client'

// Space membership role
export type SpaceRole = 'admin' | 'editor' | 'viewer' | 'client'

// Invite role
export type InviteRole = 'client' | 'member'

// Billing status
export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled'

// Scheduling proposal status
export type ProposalStatus = 'open' | 'confirmed' | 'cancelled' | 'expired'

// Slot response type
export type SlotResponseType = 'available' | 'unavailable_but_proceed' | 'unavailable'

// Respondent side
export type RespondentSide = 'client' | 'internal'

// Video conference provider
export type VideoProvider = 'zoom' | 'google_meet' | 'teams'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
          updated_at?: string
        }
      }
      org_memberships: {
        Row: {
          id: string
          org_id: string
          user_id: string
          role: OrgRole
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          role: OrgRole
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          role?: OrgRole
          created_at?: string
        }
      }
      spaces: {
        Row: {
          id: string
          org_id: string
          type: 'project' | 'personal'
          name: string
          owner_user_id: string | null
          preset_genre: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          type: 'project' | 'personal'
          name: string
          owner_user_id?: string | null
          preset_genre?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          type?: 'project' | 'personal'
          name?: string
          owner_user_id?: string | null
          preset_genre?: string | null
          created_at?: string
        }
      }
      space_memberships: {
        Row: {
          id: string
          space_id: string
          user_id: string
          role: SpaceRole
          created_at: string
        }
        Insert: {
          id?: string
          space_id: string
          user_id: string
          role: SpaceRole
          created_at?: string
        }
        Update: {
          id?: string
          space_id?: string
          user_id?: string
          role?: SpaceRole
          created_at?: string
        }
      }
      invites: {
        Row: {
          id: string
          org_id: string
          space_id: string
          email: string
          role: InviteRole
          token: string
          expires_at: string
          accepted_at: string | null
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          email: string
          role: InviteRole
          token: string
          expires_at: string
          accepted_at?: string | null
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          email?: string
          role?: InviteRole
          token?: string
          expires_at?: string
          accepted_at?: string | null
          created_by?: string
          created_at?: string
        }
      }
      plans: {
        Row: {
          id: string
          name: string
          projects_limit: number | null
          members_limit: number | null
          clients_limit: number | null
          storage_limit_bytes: number | null
          stripe_product_id: string | null
          stripe_price_id: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id: string
          name: string
          projects_limit?: number | null
          members_limit?: number | null
          clients_limit?: number | null
          storage_limit_bytes?: number | null
          stripe_product_id?: string | null
          stripe_price_id?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          projects_limit?: number | null
          members_limit?: number | null
          clients_limit?: number | null
          storage_limit_bytes?: number | null
          stripe_product_id?: string | null
          stripe_price_id?: string | null
          is_active?: boolean
          created_at?: string
        }
      }
      org_billing: {
        Row: {
          org_id: string
          plan_id: string
          status: BillingStatus
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          current_period_end: string | null
          cancel_at_period_end: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          org_id: string
          plan_id: string
          status?: BillingStatus
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          org_id?: string
          plan_id?: string
          status?: BillingStatus
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      tasks: {
        Row: {
          id: string
          org_id: string
          space_id: string
          milestone_id: string | null
          title: string
          description: string | null
          status: TaskStatus
          priority: number | null
          assignee_id: string | null
          start_date: string | null
          due_date: string | null
          ball: BallSide
          origin: BallSide
          type: TaskType
          spec_path: string | null
          decision_state: DecisionState | null
          client_scope: ClientScope
          actual_hours: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          milestone_id?: string | null
          title: string
          description?: string | null
          status?: TaskStatus
          priority?: number | null
          assignee_id?: string | null
          start_date?: string | null
          due_date?: string | null
          ball?: BallSide
          origin?: BallSide
          type?: TaskType
          spec_path?: string | null
          decision_state?: DecisionState | null
          client_scope?: ClientScope
          actual_hours?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          milestone_id?: string | null
          title?: string
          description?: string | null
          status?: TaskStatus
          priority?: number | null
          assignee_id?: string | null
          start_date?: string | null
          due_date?: string | null
          ball?: BallSide
          origin?: BallSide
          type?: TaskType
          spec_path?: string | null
          decision_state?: DecisionState | null
          client_scope?: ClientScope
          actual_hours?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      task_owners: {
        Row: {
          id: string
          org_id: string
          space_id: string
          task_id: string
          side: BallSide
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          task_id: string
          side: BallSide
          user_id: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          task_id?: string
          side?: BallSide
          user_id?: string
          created_at?: string
        }
      }
      task_events: {
        Row: {
          id: string
          org_id: string
          space_id: string
          task_id: string
          actor_id: string
          meeting_id: string | null
          action: string
          payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          task_id: string
          actor_id: string
          meeting_id?: string | null
          action: string
          payload?: Json
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          task_id?: string
          actor_id?: string
          meeting_id?: string | null
          action?: string
          payload?: Json
          created_at?: string
        }
      }
      task_comments: {
        Row: {
          id: string
          org_id: string
          space_id: string
          task_id: string
          actor_id: string
          body: string
          visibility: 'client' | 'internal'
          reply_to_id: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          task_id: string
          actor_id: string
          body: string
          visibility?: 'client' | 'internal'
          reply_to_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          task_id?: string
          actor_id?: string
          body?: string
          visibility?: 'client' | 'internal'
          reply_to_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      }
      meetings: {
        Row: {
          id: string
          org_id: string
          space_id: string
          title: string
          held_at: string | null
          notes: string | null
          status: MeetingStatus
          started_at: string | null
          ended_at: string | null
          minutes_md: string | null
          summary_subject: string | null
          summary_body: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          title: string
          held_at?: string | null
          notes?: string | null
          status?: MeetingStatus
          started_at?: string | null
          ended_at?: string | null
          minutes_md?: string | null
          summary_subject?: string | null
          summary_body?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          title?: string
          held_at?: string | null
          notes?: string | null
          status?: MeetingStatus
          started_at?: string | null
          ended_at?: string | null
          minutes_md?: string | null
          summary_subject?: string | null
          summary_body?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      meeting_participants: {
        Row: {
          id: string
          org_id: string
          space_id: string
          meeting_id: string
          user_id: string
          side: BallSide
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          meeting_id: string
          user_id: string
          side: BallSide
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          meeting_id?: string
          user_id?: string
          side?: BallSide
          created_at?: string
        }
      }
      reviews: {
        Row: {
          id: string
          org_id: string
          space_id: string
          task_id: string
          status: ReviewStatus
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          task_id: string
          status?: ReviewStatus
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          task_id?: string
          status?: ReviewStatus
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      review_approvals: {
        Row: {
          id: string
          org_id: string
          review_id: string
          reviewer_id: string
          state: ApprovalState
          blocked_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          review_id: string
          reviewer_id: string
          state?: ApprovalState
          blocked_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          review_id?: string
          reviewer_id?: string
          state?: ApprovalState
          blocked_reason?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      notifications: {
        Row: {
          id: string
          org_id: string
          space_id: string
          to_user_id: string
          channel: NotificationChannel
          type: string
          dedupe_key: string
          payload: Json
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          to_user_id: string
          channel: NotificationChannel
          type: string
          dedupe_key: string
          payload?: Json
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          to_user_id?: string
          channel?: NotificationChannel
          type?: string
          dedupe_key?: string
          payload?: Json
          created_at?: string
          read_at?: string | null
        }
      }
      api_keys: {
        Row: {
          id: string
          org_id: string
          space_id: string
          name: string
          key_hash: string
          key_prefix: string
          created_by: string
          last_used_at: string | null
          expires_at: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          name: string
          key_hash: string
          key_prefix: string
          created_by: string
          last_used_at?: string | null
          expires_at?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          name?: string
          key_hash?: string
          key_prefix?: string
          created_by?: string
          last_used_at?: string | null
          expires_at?: string | null
          is_active?: boolean
          created_at?: string
        }
      }
      milestones: {
        Row: {
          id: string
          org_id: string
          space_id: string
          name: string
          start_date: string | null
          due_date: string | null
          order_key: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          name: string
          start_date?: string | null
          due_date?: string | null
          order_key?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          name?: string
          start_date?: string | null
          due_date?: string | null
          order_key?: number
          created_at?: string
          updated_at?: string
        }
      }
      wiki_pages: {
        Row: {
          id: string
          org_id: string
          space_id: string
          title: string
          body: string
          tags: string[]
          created_by: string
          updated_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          title: string
          body?: string
          tags?: string[]
          created_by: string
          updated_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          title?: string
          body?: string
          tags?: string[]
          created_by?: string
          updated_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      wiki_page_versions: {
        Row: {
          id: string
          org_id: string
          page_id: string
          title: string
          body: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          page_id: string
          title: string
          body: string
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          page_id?: string
          title?: string
          body?: string
          created_by?: string
          created_at?: string
        }
      }
      wiki_page_publications: {
        Row: {
          id: string
          org_id: string
          milestone_id: string
          source_page_id: string
          published_title: string
          published_body: string
          published_by: string
          published_at: string
        }
        Insert: {
          id?: string
          org_id: string
          milestone_id: string
          source_page_id: string
          published_title: string
          published_body: string
          published_by: string
          published_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          milestone_id?: string
          source_page_id?: string
          published_title?: string
          published_body?: string
          published_by?: string
          published_at?: string
        }
      }
      scheduling_proposals: {
        Row: {
          id: string
          org_id: string
          space_id: string
          title: string
          description: string | null
          duration_minutes: number
          status: ProposalStatus
          version: number
          confirmed_slot_id: string | null
          confirmed_meeting_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          video_provider: VideoProvider | null
          meeting_url: string | null
          external_meeting_id: string | null
          expires_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          space_id: string
          title: string
          description?: string | null
          duration_minutes?: number
          status?: ProposalStatus
          version?: number
          confirmed_slot_id?: string | null
          confirmed_meeting_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          video_provider?: VideoProvider | null
          meeting_url?: string | null
          external_meeting_id?: string | null
          expires_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          space_id?: string
          title?: string
          description?: string | null
          duration_minutes?: number
          status?: ProposalStatus
          version?: number
          confirmed_slot_id?: string | null
          confirmed_meeting_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          video_provider?: VideoProvider | null
          meeting_url?: string | null
          external_meeting_id?: string | null
          expires_at?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      proposal_slots: {
        Row: {
          id: string
          proposal_id: string
          start_at: string
          end_at: string
          slot_order: number
          created_at: string
        }
        Insert: {
          id?: string
          proposal_id: string
          start_at: string
          end_at: string
          slot_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          proposal_id?: string
          start_at?: string
          end_at?: string
          slot_order?: number
          created_at?: string
        }
      }
      proposal_respondents: {
        Row: {
          id: string
          proposal_id: string
          user_id: string
          side: RespondentSide
          is_required: boolean
          created_at: string
        }
        Insert: {
          id?: string
          proposal_id: string
          user_id: string
          side: RespondentSide
          is_required?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          proposal_id?: string
          user_id?: string
          side?: RespondentSide
          is_required?: boolean
          created_at?: string
        }
      }
      slot_responses: {
        Row: {
          id: string
          slot_id: string
          respondent_id: string
          response: SlotResponseType
          responded_at: string
        }
        Insert: {
          id?: string
          slot_id: string
          respondent_id: string
          response: SlotResponseType
          responded_at?: string
        }
        Update: {
          id?: string
          slot_id?: string
          respondent_id?: string
          response?: SlotResponseType
          responded_at?: string
        }
      }
    }
    Functions: {
      rpc_pass_ball: {
        Args: {
          task_id: string
          ball: BallSide
          client_owner_ids: string[]
          internal_owner_ids: string[]
          reason?: string
          meeting_id?: string
        }
        Returns: { ok: boolean }
      }
      rpc_decide_considering: {
        Args: {
          task_id: string
          decision_text: string
          on_behalf_of: BallSide
          evidence: EvidenceType
          client_confirmed_by?: string
          meeting_id?: string
        }
        Returns: { ok: boolean }
      }
      rpc_set_spec_state: {
        Args: {
          task_id: string
          decision_state: DecisionState
          meeting_id?: string
          note?: string
        }
        Returns: { ok: boolean }
      }
      rpc_review_open: {
        Args: {
          task_id: string
          reviewer_ids: string[]
          meeting_id?: string
        }
        Returns: { ok: boolean }
      }
      rpc_review_approve: {
        Args: {
          task_id: string
          meeting_id?: string
        }
        Returns: { ok: boolean }
      }
      rpc_review_block: {
        Args: {
          task_id: string
          blocked_reason: string
          meeting_id?: string
        }
        Returns: { ok: boolean }
      }
      rpc_meeting_start: {
        Args: {
          meeting_id: string
        }
        Returns: { ok: boolean }
      }
      rpc_meeting_end: {
        Args: {
          meeting_id: string
        }
        Returns: {
          ok: boolean
          summary_subject: string
          summary_body: string
          counts: {
            decided: number
            open: number
            ball_client: number
          }
        }
      }
      rpc_generate_meeting_minutes: {
        Args: {
          meeting_id: string
        }
        Returns: {
          email_subject: string
          email_body: string
          in_app_title: string
          in_app_body: string
          counts: {
            decided: number
            open: number
            ball_client: number
          }
          nearest_due: string | null
        }
      }
      rpc_confirm_proposal_slot: {
        Args: {
          p_proposal_id: string
          p_slot_id: string
        }
        Returns: {
          ok: boolean
          meeting_id?: string
          slot_start?: string
          slot_end?: string
          error?: string
          current_status?: string
          required?: number
          eligible?: number
        }
      }
    }
  }
}

// Utility types for easier access
export type Tables = Database['public']['Tables']
export type Organization = Tables['organizations']['Row']
export type OrgMembership = Tables['org_memberships']['Row']
export type Space = Tables['spaces']['Row']
export type SpaceMembership = Tables['space_memberships']['Row']
export type Invite = Tables['invites']['Row']
export type Plan = Tables['plans']['Row']
export type OrgBilling = Tables['org_billing']['Row']
export type Task = Tables['tasks']['Row']
export type TaskInsert = Tables['tasks']['Insert']
export type TaskUpdate = Tables['tasks']['Update']
export type TaskOwner = Tables['task_owners']['Row']
export type TaskEvent = Tables['task_events']['Row']
export type TaskComment = Tables['task_comments']['Row']
export type TaskCommentInsert = Tables['task_comments']['Insert']
export type TaskCommentUpdate = Tables['task_comments']['Update']
export type Meeting = Tables['meetings']['Row']
export type MeetingParticipant = Tables['meeting_participants']['Row']
export type Review = Tables['reviews']['Row']
export type ReviewApproval = Tables['review_approvals']['Row']
export type Notification = Tables['notifications']['Row']
export type ApiKey = Tables['api_keys']['Row']
export type Milestone = Tables['milestones']['Row']
export type MilestoneInsert = Tables['milestones']['Insert']
export type MilestoneUpdate = Tables['milestones']['Update']
export type WikiPage = Tables['wiki_pages']['Row']
export type WikiPageInsert = Tables['wiki_pages']['Insert']
export type WikiPageUpdate = Tables['wiki_pages']['Update']
export type WikiPageVersion = Tables['wiki_page_versions']['Row']
export type WikiPagePublication = Tables['wiki_page_publications']['Row']
export type SchedulingProposal = Tables['scheduling_proposals']['Row']
export type SchedulingProposalInsert = Tables['scheduling_proposals']['Insert']
export type SchedulingProposalUpdate = Tables['scheduling_proposals']['Update']
export type ProposalSlot = Tables['proposal_slots']['Row']
export type ProposalSlotInsert = Tables['proposal_slots']['Insert']
export type ProposalRespondent = Tables['proposal_respondents']['Row']
export type ProposalRespondentInsert = Tables['proposal_respondents']['Insert']
export type SlotResponse = Tables['slot_responses']['Row']
export type SlotResponseInsert = Tables['slot_responses']['Insert']
