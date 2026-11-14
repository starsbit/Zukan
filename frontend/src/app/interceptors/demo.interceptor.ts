import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, throwError } from 'rxjs';

export const DEMO_READ_ONLY_MESSAGE = 'Disabled in the demo: this instance is read-only.';

export const demoInterceptor: HttpInterceptorFn = (req, next) => {
  const snackBar = inject(MatSnackBar);
  return next(req).pipe(
    catchError((err) => {
      if (err instanceof HttpErrorResponse && err.status === 403 && err.error?.code === 'demo_read_only') {
        snackBar.open(DEMO_READ_ONLY_MESSAGE, 'OK');
      }
      return throwError(() => err);
    }),
  );
};
