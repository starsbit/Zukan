import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface MessageSegment {
  kind: 'text' | 'link';
  value: string;
}

interface MessageLine {
  key: string;
  segments: MessageSegment[];
}

@Component({
  selector: 'zukan-formatted-message',
  templateUrl: './formatted-message.component.html',
  styleUrl: './formatted-message.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormattedMessageComponent {
  readonly text = input('');
  readonly lines = computed<MessageLine[]>(() => this.parseLines(this.text()));

  private parseLines(text: string): MessageLine[] {
    return text.split(/\r?\n/).map((line, index) => ({
      key: `${index}:${line}`,
      segments: this.parseSegments(line),
    }));
  }

  private parseSegments(line: string): MessageSegment[] {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const segments: MessageSegment[] = [];
    let lastIndex = 0;

    for (const match of line.matchAll(urlPattern)) {
      const url = match[0];
      const start = match.index ?? 0;
      if (start > lastIndex) {
        segments.push({ kind: 'text', value: line.slice(lastIndex, start) });
      }
      segments.push({ kind: 'link', value: url });
      lastIndex = start + url.length;
    }

    if (lastIndex < line.length) {
      segments.push({ kind: 'text', value: line.slice(lastIndex) });
    }

    if (segments.length === 0) {
      segments.push({ kind: 'text', value: '' });
    }

    return segments;
  }
}
