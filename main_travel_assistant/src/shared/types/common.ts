export enum Intent {
  GET_TICKET_PRICE = 'GET_TICKET_PRICE',
  GET_OPENING_HOURS = 'GET_OPENING_HOURS',
  GET_WEATHER = 'GET_WEATHER',
  SEARCH_NEARBY = 'SEARCH_NEARBY',
  GET_DIRECTIONS = 'GET_DIRECTIONS',
  SEARCH_TOUR = 'SEARCH_TOUR',
  GET_PLACE_INFO = 'GET_PLACE_INFO',
  UNKNOWN = 'UNKNOWN'
}

export interface ServiceResponse {
  success: boolean;
  type: string;
  data: any;
  message: string;
  _clarifyMessage?: string;
}

export interface UserContext {
  sessionId: string;
  userId: string;
  updateId?: number;
  message: string;
  messageLower: string;
  userLocation?: { lat: number; lng: number } | null;
}
