import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Response } from "express";
import { catchError, throwError, type Observable } from "rxjs";

/**
 * Purpose: keep error answers of cached routes out of the browser's cache, and label them as the JSON they are.
 * The street-network routes declare `Cache-Control: private, max-age=86400` and an XML or JSON content type for
 * their answers; without this, a 502 while OpenStreetMap was unreachable was kept by the browser for a day (and
 * served after the data came back), and the JSON error body went out as `application/xml`.
 * Side effects: on an error, replaces those two headers on the response before the exception filter writes it.
 */
@Injectable()
export class NoStoreOnError implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        const res = ctx.switchToHttp().getResponse<Response>();
        if (!res.headersSent) {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        return throwError(() => err);
      }),
    );
  }
}
