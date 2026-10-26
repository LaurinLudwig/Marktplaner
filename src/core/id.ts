import { nanoid } from 'nanoid';

/** Kurze, kollisionsarme ID für Pages und Objekte. */
export const newId = (): string => nanoid(10);
