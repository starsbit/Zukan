import { MediaRead } from '../models/media';

export const INTERNAL_MEDIA_DRAG_TYPE = 'application/x-zukan-media';

export function isInternalMediaDrag(dataTransfer: DataTransfer | null): boolean {
  return !!dataTransfer && Array.from(dataTransfer.types).includes(INTERNAL_MEDIA_DRAG_TYPE);
}

export function populateMediaDragData(
  dataTransfer: DataTransfer | null,
  media: MediaRead,
  fileUrl: string,
): void {
  if (!dataTransfer) {
    return;
  }

  const filename = (media.original_filename ?? media.filename).replace(/[:\\/]/g, '_');
  const mimeType = media.metadata.mime_type ?? 'application/octet-stream';
  const absoluteUrl = new URL(fileUrl, document.baseURI).href;

  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(INTERNAL_MEDIA_DRAG_TYPE, media.id);
  dataTransfer.setData('DownloadURL', `${mimeType}:${filename}:${absoluteUrl}`);
}
