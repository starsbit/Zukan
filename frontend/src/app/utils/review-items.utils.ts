import {
  ImportBatchRecommendationGroupRead,
  ImportBatchReviewItemRead,
} from '../models/processing';
import { EntityRead, MediaEntityType } from '../models/relations';

export interface ReviewEntityUpdate {
  mediaIds: string[];
  characterNames: string[];
  seriesNames: string[];
}

export interface ReviewEntityUpdateResult {
  items: ImportBatchReviewItemRead[];
  resolvedCount: number;
}

export function applyReviewEntityUpdateToItems(
  items: ImportBatchReviewItemRead[],
  update: ReviewEntityUpdate,
): ReviewEntityUpdateResult {
  const targetIds = new Set(update.mediaIds);
  const characterNames = normalizeNames(update.characterNames);
  const seriesNames = normalizeNames(update.seriesNames);
  const nextItems: ImportBatchReviewItemRead[] = [];
  let resolvedCount = 0;

  for (const item of items) {
    if (!targetIds.has(item.media.id)) {
      nextItems.push(item);
      continue;
    }

    const nextItem: ImportBatchReviewItemRead = {
      ...item,
      missing_character: item.missing_character && characterNames.length === 0,
      missing_series: item.missing_series && seriesNames.length === 0,
      entities: [
        ...appendOptimisticEntities(item.entities, MediaEntityType.CHARACTER, characterNames),
        ...appendOptimisticEntities(item.entities, MediaEntityType.SERIES, seriesNames),
      ],
    };

    if (nextItem.missing_character || nextItem.missing_series) {
      nextItems.push(nextItem);
    } else {
      resolvedCount += 1;
    }
  }

  return { items: nextItems, resolvedCount };
}

export function refreshRecommendationGroupsForItems(
  groups: ImportBatchRecommendationGroupRead[],
  items: ImportBatchReviewItemRead[],
): ImportBatchRecommendationGroupRead[] {
  const itemByMediaId = new Map(items.map((item) => [item.media.id, item]));

  return groups
    .map((group) => {
      const mediaIds = group.media_ids.filter((id) => itemByMediaId.has(id));
      return {
        ...group,
        media_ids: mediaIds,
        item_count: mediaIds.length,
        missing_character_count: mediaIds
          .filter((id) => itemByMediaId.get(id)?.missing_character)
          .length,
        missing_series_count: mediaIds
          .filter((id) => itemByMediaId.get(id)?.missing_series)
          .length,
      };
    })
    .filter((group) => group.media_ids.length > 0);
}

function appendOptimisticEntities(
  currentEntities: EntityRead[],
  entityType: MediaEntityType,
  names: string[],
): EntityRead[] {
  const existingNames = new Set(
    currentEntities
      .filter((entity) => entity.entity_type === entityType)
      .map((entity) => entity.name.toLocaleLowerCase()),
  );
  const optimisticEntities = names
    .filter((name) => !existingNames.has(name.toLocaleLowerCase()))
    .map((name) => ({
      id: `optimistic:${entityType}:${name}`,
      entity_type: entityType,
      entity_id: null,
      name,
      role: 'primary',
      source: 'manual',
      confidence: 1,
    }));

  return [
    ...currentEntities.filter((entity) => entity.entity_type === entityType),
    ...optimisticEntities,
  ];
}

function normalizeNames(names: string[]): string[] {
  return Array.from(new Set(names.map((name) => name.trim()).filter((name) => !!name)));
}
