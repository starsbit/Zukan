import { MediaListState } from '../../models/media';
import { MediaSearchParams } from '../../services/web/media-client.service';

export function buildFavoritesParams(sharedParams: MediaSearchParams): MediaSearchParams {
  const { favorited: _favorited, ...remaining } = sharedParams;
  return {
    ...remaining,
    state: MediaListState.ACTIVE,
    favorited: true,
  };
}
