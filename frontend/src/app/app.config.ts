import { APP_INITIALIZER, ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { AuthService } from './services/auth.service';
import { authInterceptor } from './services/web/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [AuthService],
      useFactory: (authService: AuthService) => () => new Promise<void>((resolve) => {
        authService.initializeSession().subscribe({
          next: () => resolve(),
          error: () => resolve()
        });
      })
    }
  ]
};
