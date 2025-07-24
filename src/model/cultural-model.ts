export interface CulturalMediaResponse {
  province: string;
  media_type: string;
  media_url: string;
  cultural_category: string;
  query: string;
  cultural_context?: string;
}

export interface StreamStatusMessage {
  type: "status";
  message: string;
  timestamp: string;
}

export interface StreamErrorMessage {
  detail: string;
}

export interface StreamCompleteMessage {
  message: string;
  total: number;
}

export type StreamMessage = CulturalMediaResponse | StreamStatusMessage | StreamErrorMessage | StreamCompleteMessage;