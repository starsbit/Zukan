import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'zukan-forgot-password-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './forgot-password-dialog.component.html',
  styleUrl: './forgot-password-dialog.component.scss',
})
export class ForgotPasswordDialogComponent {}
