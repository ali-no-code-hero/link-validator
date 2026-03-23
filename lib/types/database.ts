export type ProcessingStatus = "pending" | "completed" | "failed";

export type RedirectChainEntry = {
  url: string;
  status?: number;
  type: "http_redirect" | "navigation" | "request" | "document_response";
};

export type JobsFetchedRow = {
  id: string;
  batch_id: string;
  job_eid: string;
  title: string | null;
  location: string | null;
  company: string | null;
  url: string;
  is_remote: boolean | null;
  industry: string | null;
  date_posted: string | null;
  salary_min: string | null;
  salary_max: string | null;
  salary_period: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  processing_status: ProcessingStatus;
};

export type ClickLogsRow = {
  id: string;
  job_eid: string;
  job_fetched_id: string | null;
  batch_id: string;
  initial_url: string;
  final_destination_url: string | null;
  redirect_chain: RedirectChainEntry[];
  ip_address_used: string | null;
  user_agent_device_id: string | null;
  status_code: number | null;
  timestamp: string;
  extra_tracking_data: Record<string, unknown>;
};
