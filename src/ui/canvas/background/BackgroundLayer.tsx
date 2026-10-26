import { memo, useEffect, useRef, useState } from 'react';
import { visibleSourceRegion } from '../../../core/background';
import { userMessage } from '../../../core/errors';
import type { Background, View } from '../../../core/model/types';
import { screenToWorld } from '../../../core/viewport';
import { chooseLevel, needsPyramid, pyramidFor, tilesFor, tileUrl, type Tile } from './rasterPyramid';
import { DETAIL_MAX_PIXELS, imageUrl, pdfBase, pdfEntry, renderPdfRegion, scaleForBudget, type RenderedImage } from './renderer';

/** Wartezeit nach der letzten Ansichtsänderung, bevor ein scharfes Detailbild gerendert wird. */
const DETAIL_DELAY_MS = 150;

interface Props {
  background: Background;
  bytes: Uint8Array | undefined;
  view: View;
  viewport: { w: number; h: number };
  selected: boolean;
  /** Ziehen/Auswählen erlaubt (nicht gesperrt, Auswahlwerkzeug aktiv). */
  interactive: boolean;
}

/**
 * Hintergrundplan in Weltkoordinaten. Die Gruppe bildet Quell-Einheiten auf Meter ab
 * (siehe core/background.ts); alle Bilder liegen deshalb in Quell-Einheiten.
 */
export const BackgroundLayer = memo(function BackgroundLayer({ background: bg, bytes, view, viewport, selected, interactive }: Props) {
  const { transform: t, pxSize } = bg;
  const groupTransform = `translate(${t.x} ${t.y}) rotate(${t.rot}) scale(${t.metersPerPx})`;
  // Linienbreite in Quell-Einheiten für 1,5 Bildschirmpixel
  const hairline = 1.5 / (view.scale * t.metersPerPx);

  return (
    <g className="background-layer" transform={groupTransform}>
      <g opacity={bg.opacity}>
        {!bytes ? (
          <MissingAsset w={pxSize.w} h={pxSize.h} stroke={hairline} />
        ) : bg.kind === 'pdf' ? (
          <PdfImage bg={bg} bytes={bytes} view={view} viewport={viewport} />
        ) : bg.kind === 'image' && needsPyramid(pxSize) ? (
          <TiledImage bg={bg} bytes={bytes} view={view} viewport={viewport} />
        ) : (
          <image href={imageUrl(bg.assetId, bytes)} x={0} y={0} width={pxSize.w} height={pxSize.h} preserveAspectRatio="none" />
        )}
      </g>
      <rect
        className={`background-hit${interactive ? ' interactive' : ''}`}
        data-kind="background"
        x={0}
        y={0}
        width={pxSize.w}
        height={pxSize.h}
      />
      {selected && <rect className="background-selection" x={0} y={0} width={pxSize.w} height={pxSize.h} strokeWidth={hairline} />}
    </g>
  );
});

function MissingAsset({ w, h, stroke }: { w: number; h: number; stroke: number }) {
  return (
    <g className="background-missing">
      <rect x={0} y={0} width={w} height={h} strokeWidth={stroke} strokeDasharray={`${stroke * 6} ${stroke * 4}`} />
      <text x={w / 2} y={h / 2} fontSize={Math.min(w, h) / 20} textAnchor="middle" dominantBaseline="central">
        Plandatei fehlt in der Projektdatei
      </text>
    </g>
  );
}

function PdfImage({ bg, bytes, view, viewport }: { bg: Background; bytes: Uint8Array; view: View; viewport: { w: number; h: number } }) {
  // Gerenderte Bilder gehören zur Datei (assetId); beim Ersetzen gelten die alten nicht mehr
  const [baseState, setBaseState] = useState<{ assetId: string; img: RenderedImage | null; error: string | null }>({
    assetId: '',
    img: null,
    error: null,
  });
  const [detailState, setDetailState] = useState<{ assetId: string; img: RenderedImage } | null>(null);
  const base = baseState.assetId === bg.assetId ? baseState.img : null;
  const error = baseState.assetId === bg.assetId ? baseState.error : null;
  const detail = detailState?.assetId === bg.assetId ? detailState.img : null;

  useEffect(() => {
    let alive = true;
    pdfBase(bg.assetId, bytes).then(
      (img) => alive && setBaseState({ assetId: bg.assetId, img, error: null }),
      (e: unknown) => alive && setBaseState({ assetId: bg.assetId, img: null, error: userMessage(e, 'Die PDF-Datei kann nicht dargestellt werden.') }),
    );
    return () => {
      alive = false;
    };
  }, [bg.assetId, bytes]);

  // Detailbild nach kurzer Ruhe neu rendern, wenn stärker vergrößert als das Grundbild
  const generation = useRef(0);
  const detailRef = useRef<RenderedImage | null>(null);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);
  useEffect(() => {
    if (!base || viewport.w === 0) return;
    const gen = ++generation.current;
    const timer = setTimeout(async () => {
      const dpr = window.devicePixelRatio || 1;
      const wanted = view.scale * bg.transform.metersPerPx * dpr; // Bildschirmpixel pro Punkt
      if (wanted <= base.scale * 1.1) {
        setDetailState((old) => {
          if (old) URL.revokeObjectURL(old.img.url);
          return null;
        });
        return;
      }
      const tl = screenToWorld(view, { x: 0, y: 0 });
      const br = screenToWorld(view, { x: viewport.w, y: viewport.h });
      const region = visibleSourceRegion(bg.transform, bg.pxSize, { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y });
      if (!region) return;
      const prev = detailRef.current;
      // Vorhandenes Detailbild reicht noch: deckt den Ausschnitt ab und ist scharf genug
      if (
        prev &&
        prev.scale >= wanted * 0.95 &&
        prev.region.minX <= region.minX &&
        prev.region.minY <= region.minY &&
        prev.region.maxX >= region.maxX &&
        prev.region.maxY >= region.maxY
      ) {
        return;
      }
      const page = await pdfEntry(bg.assetId, bytes).page;
      const regionSize = { w: region.maxX - region.minX, h: region.maxY - region.minY };
      const scale = Math.min(wanted, scaleForBudget(regionSize, DETAIL_MAX_PIXELS, Number.POSITIVE_INFINITY));
      const img = await renderPdfRegion(page, region, scale, () => gen !== generation.current).catch(() => null);
      if (!img || gen !== generation.current) {
        if (img) URL.revokeObjectURL(img.url);
        return;
      }
      setDetailState((old) => {
        if (old) URL.revokeObjectURL(old.img.url);
        return { assetId: bg.assetId, img };
      });
    }, DETAIL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [base, view, viewport.w, viewport.h, bg.transform, bg.pxSize, bg.assetId, bytes]);

  if (error) {
    const size = bg.pxSize;
    return (
      <text x={size.w / 2} y={size.h / 2} fontSize={Math.min(size.w, size.h) / 25} textAnchor="middle" className="background-error">
        {error}
      </text>
    );
  }
  if (!base) return <rect x={0} y={0} width={bg.pxSize.w} height={bg.pxSize.h} className="background-loading" />;
  return (
    <>
      <image href={base.url} x={0} y={0} width={bg.pxSize.w} height={bg.pxSize.h} preserveAspectRatio="none" />
      {detail && (
        <image
          href={detail.url}
          x={detail.region.minX}
          y={detail.region.minY}
          width={detail.region.maxX - detail.region.minX}
          height={detail.region.maxY - detail.region.minY}
          preserveAspectRatio="none"
        />
      )}
    </>
  );
}

/** Große Rasterbilder: Übersicht plus sichtbare Kacheln der passenden Stufe (siehe rasterPyramid.ts). */
function TiledImage({ bg, bytes, view, viewport }: { bg: Background; bytes: Uint8Array; view: View; viewport: { w: number; h: number } }) {
  const pyr = pyramidFor(bg.assetId, bytes, bg.pxSize);
  const [overview, setOverview] = useState<{ assetId: string; url: string } | null>(null);
  const [tiles, setTiles] = useState<{ assetId: string; list: Tile[] } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let alive = true;
    void pyr.overview.then((url) => alive && setOverview({ assetId: bg.assetId, url }));
    return () => {
      alive = false;
    };
  }, [pyr, bg.assetId]);

  // Nach kurzer Ruhe die Kacheln der passenden Stufe laden; bis dahin bleibt das Bisherige stehen
  useEffect(() => {
    if (viewport.w === 0) return;
    const gen = ++generation.current;
    const timer = setTimeout(async () => {
      const dpr = window.devicePixelRatio || 1;
      const level = chooseLevel(pyr, view.scale * bg.transform.metersPerPx * dpr);
      if (level === null) {
        setTiles(null);
        return;
      }
      const tl = screenToWorld(view, { x: 0, y: 0 });
      const br = screenToWorld(view, { x: viewport.w, y: viewport.h });
      const region = visibleSourceRegion(bg.transform, bg.pxSize, { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y });
      if (!region) return;
      const wanted = tilesFor(pyr, level, region);
      const list = await Promise.all(
        wanted.map(async (t) => ({ key: `${level}/${t.tx}/${t.ty}`, url: await tileUrl(bg.assetId, pyr, level, t), x: t.x, y: t.y, w: t.w, h: t.h })),
      ).catch(() => null);
      if (list && gen === generation.current) setTiles({ assetId: bg.assetId, list });
    }, TILE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pyr, view, viewport.w, viewport.h, bg.transform, bg.pxSize, bg.assetId]);

  const ov = overview?.assetId === bg.assetId ? overview.url : null;
  const list = tiles?.assetId === bg.assetId ? tiles.list : [];
  if (!ov) return <rect x={0} y={0} width={bg.pxSize.w} height={bg.pxSize.h} className="background-loading" />;
  return (
    <>
      <image href={ov} x={0} y={0} width={bg.pxSize.w} height={bg.pxSize.h} preserveAspectRatio="none" className="raster-overview" />
      {list.map((t) => (
        <image key={t.key} href={t.url} x={t.x} y={t.y} width={t.w} height={t.h} preserveAspectRatio="none" className="raster-tile" />
      ))}
    </>
  );
}

const TILE_DELAY_MS = 120;
