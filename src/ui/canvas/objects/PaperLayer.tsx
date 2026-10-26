import { memo } from 'react';
import type { PagePaper, PaperKind } from '../../../core/paper';
import { legendFramePrims, legendRowPrims, northArrowPrims, scaleBarPrims, titleBlockPrims } from '../../../core/scene/paper';
import type { Prim } from '../../../core/scene/prims';
import { FORMAT_TEXT, mmToM, scaleText } from '../../../core/sheet';
import type { Sheet, Vec } from '../../../core/model/types';
import type { PaperElement } from '../../../state/store';
import { Prims } from '../scene/Prim';

/**
 * Blatt und Papier-Elemente in Weltkoordinaten (M7, M8, spec.md §8). Die Papier-Elemente kommen aus den Bausteinen
 * der gemeinsamen Szene (core/scene/paper.ts) in mm und werden mit n/1000 skaliert: So sind sie auf dem Papier immer
 * gleich groß, und die Schriftgrößen im SVG bleiben handlich. Papier-Elemente sehen aus wie auf dem Ausdruck (weiß,
 * dunkle Schrift), auch im dunklen Design. Rahmen und Marke gibt es nur auf dem Bildschirm.
 */
interface Props {
  paper: PagePaper;
  sheet: Sheet;
  visible: Record<PaperKind, boolean>;
  selected: PaperElement | null;
  locked: boolean;
}

const TEST_ID: Record<PaperKind, string> = { titleBlock: 'title-block', legend: 'legend', scaleBar: 'scale-bar', northArrow: 'north-arrow' };

export const PaperLayer = memo(function PaperLayer({ paper, sheet, visible, selected, locked }: Props) {
  const { frame } = paper;
  const b = frame.bounds;
  const k = mmToM(1, frame.scale);
  const label = `${FORMAT_TEXT(sheet)} · ${scaleText(frame.scale)}${frame.fit ? ' (angepasst)' : ''}`;
  const el = (kind: PaperKind, at: Vec, prims: Prim[], children?: React.ReactNode) =>
    visible[kind] && (
      <PaperEl key={kind} kind={kind} at={at} k={k} prims={prims} selected={selected === kind}>
        {children}
      </PaperEl>
    );
  const legend = paper.legend;
  return (
    <g className={`layer-sheet${locked ? ' locked' : ''}`}>
      <rect className={`sheet-frame${selected === 'sheet' ? ' selected' : ''}`} data-testid="sheet-frame" x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} />
      <g transform={`translate(${b.minX} ${b.minY}) scale(${k})`}>
        <text className="sheet-label" data-testid="sheet-label" x={2} y={-2} fontSize={4}>
          {label}
        </text>
      </g>
      {el('scaleBar', paper.scaleBar.topLeft, scaleBarPrims(paper.scaleBar.layout, frame.scale))}
      {el('northArrow', paper.northArrow.topLeft, northArrowPrims(paper.northArrow.layout.angle))}
      {legend &&
        el(
          'legend',
          legend.topLeft,
          legendFramePrims(legend.layout),
          legend.layout.rows.map((r) => (
            <g key={r.entry.key} data-entry={r.entry.key}>
              <Prims prims={legendRowPrims(r)} sized />
            </g>
          )),
        )}
      {el('titleBlock', paper.titleBlock.topLeft, titleBlockPrims(paper.titleBlock.layout))}
    </g>
  );
});

function PaperEl({ kind, at, k, prims, selected, children }: { kind: PaperKind; at: Vec; k: number; prims: Prim[]; selected: boolean; children?: React.ReactNode }) {
  return (
    <g className={`paper-el ${TEST_ID[kind]}${selected ? ' selected' : ''}`} data-testid={TEST_ID[kind]} transform={`translate(${at.x} ${at.y}) scale(${k})`}>
      <Prims prims={prims} sized />
      {children}
    </g>
  );
}
