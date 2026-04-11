import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  selector: 'zukan-contact-dialog',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './contact-dialog.component.html',
  styleUrl: './contact-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactDialogComponent {
  readonly links = [
    { href: 'https://x.com/starsbit1', icon: '/assets/social/x.svg', label: 'X' },
    { href: 'https://ko-fi.com/starsbit', icon: '/assets/social/ko-fi.svg', label: 'Ko-Fi' },
    { href: 'https://steamcommunity.com/profiles/76561198162091272', icon: '/assets/social/steam.svg', label: 'Steam' },
    { href: 'https://github.com/starsbit', icon: '/assets/social/github.svg', label: 'GitHub' },
  ];
}
