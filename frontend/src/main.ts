import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

document.title = environment.appVersion ? `Zukan - ${environment.appVersion}` : 'Zukan';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
