import { MediaRead } from '../models/api';

export function createMediaRead(overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id: 'media-1',
    uploader_id: 'user-1',
    filename: 'image.png',
    original_filename: 'original-image.png',
    media_type: 'image',
    metadata: {
      file_size: 2048,
      width: 800,
      height: 600,
      duration_seconds: null,
      frame_count: 1,
      mime_type: 'image/png',
      captured_at: '2024-01-01T12:00:00.000Z'
    },
    tags: ['fox'],
    character_name: null,
    is_nsfw: false,
    tagging_status: 'done',
    thumbnail_status: 'done',
    poster_status: 'done',
    created_at: '2024-01-01T12:00:00.000Z',
    deleted_at: null,
    is_favorited: false,
    ...overrides
  };
}
