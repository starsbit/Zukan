export interface GalleryTimelineMonth {
  year: number;
  month: number;
  count: number;
  position: number;
  rendered: boolean;
  anchorId: string | null;
}

export interface GalleryTimelineYear {
  year: number;
  count: number;
  months: GalleryTimelineMonth[];
}
