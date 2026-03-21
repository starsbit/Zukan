import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { UserRead, UserUpdateDto } from '../../models/api';
import { ClientApiService } from './api.service';

@Injectable({
  providedIn: 'root'
})
export class UsersClientService {
  private readonly api = inject(ClientApiService);

  getMe(): Observable<UserRead> {
    return this.api.get<UserRead>('/users/me');
  }

  updateMe(body: UserUpdateDto): Observable<UserRead> {
    return this.api.patch<UserRead>('/users/me', body);
  }
}
