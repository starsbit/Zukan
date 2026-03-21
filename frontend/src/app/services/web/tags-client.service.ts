import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ListTagsQuery, TagRead } from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class TagsClientService {
  private readonly api = inject(ClientApiService);

  list(query?: ListTagsQuery): Observable<TagRead[]> {
    return this.api.get<TagRead[]>('/tags', { query });
  }
}
