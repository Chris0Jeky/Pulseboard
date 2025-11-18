/**
 * TypeScript types matching backend API models
 */

export interface Dashboard {
  id: string
  name: string
  description: string | null
  layout_json: string
  created_at: string
  updated_at: string
  panels?: Panel[]
}

export interface DashboardCreate {
  name: string
  description?: string | null
  layout_json?: string
}

export interface DashboardUpdate {
  name?: string
  description?: string | null
  layout_json?: string
}

export interface FeedDefinition {
  id: string
  type: string
  name: string
  config_json: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface FeedType {
  type: string
  name: string
  description: string
  default_config: Record<string, unknown>
}

export interface FeedCreate {
  type: string
  name: string
  config_json?: string
  enabled?: boolean
}

export interface Panel {
  id: string
  dashboard_id: string
  type: string
  title: string
  feed_ids_json: string
  options_json: string
  position_x: number
  position_y: number
  width: number
  height: number
}

export interface PanelCreate {
  type: string
  title: string
  feed_ids_json?: string
  options_json?: string
  position_x?: number
  position_y?: number
  width?: number
  height?: number
}

export interface FeedEvent {
  feed_id: string
  ts: string
  payload: Record<string, any>
}

export interface FeedEventMessage {
  type: 'feed_update'
  feed_id: string
  ts: string
  payload: Record<string, any>
}

export type PanelType = 'stat' | 'timeseries' | 'bar' | 'table'

export interface PanelOptions {
  field?: string
  fields?: string[]
  color?: string
  colors?: string[]
  unit?: string
  prefix?: string
  suffix?: string
  decimals?: number
  max?: number
  min?: number
  thresholds?: Array<{
    value: number
    color: string
  }>
}

export interface WSStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}
