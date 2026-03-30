export interface TimelineBucket {
  year: number;
  month: number;
  count: number;
}

export interface MediaTimeline {
  buckets: TimelineBucket[];
}

export interface TimelineYearGroup {
  year: number;
  count: number;
  months: TimelineBucket[];
}
