import { create } from 'zustand';

/** Auswahl einer Seite aus einem mehrseitigen PDF (Dialog: ui/shell/PdfPagePicker.tsx). */
export interface PagePickerRequest {
  fileName: string;
  pageCount: number;
  /** Liefert eine Vorschau (Objekt-URL) der Seite n (1-basiert). */
  thumbnail: (n: number) => Promise<string>;
  resolve: (page: number | null) => void;
}

export const usePagePicker = create<{ request: PagePickerRequest | null }>()(() => ({ request: null }));

export function pickPdfPage(opts: Omit<PagePickerRequest, 'resolve'>): Promise<number | null> {
  return new Promise((resolve) => {
    usePagePicker.setState({
      request: {
        ...opts,
        resolve: (page) => {
          usePagePicker.setState({ request: null });
          resolve(page);
        },
      },
    });
  });
}
