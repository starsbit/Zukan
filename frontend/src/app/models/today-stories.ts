import { MediaRead } from './media';

export interface TodayStoryItem extends MediaRead {
  yearsAgo: number;
  yearsAgoLabel: string;
  capturedDateLabel: string;
}

export interface TodayStoryGroup {
  yearsAgo: number;
  yearsAgoLabel: string;
  capturedDateLabel: string;
  coverItem: TodayStoryItem;
  items: TodayStoryItem[];
}

export interface TodayStoriesViewerData {
  yearsAgo: number;
  initialIndex: number;
}

export interface TodayStoriesViewerResult {
  action: 'open' | 'reveal';
  item: TodayStoryItem;
}
