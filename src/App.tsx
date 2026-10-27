import { useEffect } from 'react';
import { startAutosave } from './app/autosave';
import { offerRecovery, startOpenedFiles } from './app/fileActions';
import { loadRecent } from './state/recent';
import { startKeyboard } from './app/keyboard';
import { guardClose, startWindowTitle } from './app/window';
import { START_PAGE, useStore } from './state/store';
import { Canvas } from './ui/canvas/Canvas';
import { ControlBar } from './ui/shell/ControlBar';
import { DialogHost } from './ui/shell/DialogHost';
import { PdfPagePicker } from './ui/shell/PdfPagePicker';
import { CategoryListDialog } from './ui/shell/CategoryListDialog';
import { RenumberDialog } from './ui/shell/RenumberDialog';
import { StartScreen } from './ui/shell/StartScreen';
import { ExportDialog } from './ui/export/ExportDialog';
import { ExportProgress } from './ui/export/ExportProgress';
import { ShortcutsOverlay } from './ui/shell/ShortcutsOverlay';
import { Toasts } from './ui/shell/Toasts';
import { Sidebar } from './ui/shell/Sidebar';
import { TabBar } from './ui/shell/TabBar';
import { Toolbar } from './ui/shell/Toolbar';
import { TooltipHost } from './ui/shell/TooltipHost';
import { StartPage } from './ui/startpage/StartPage';

/** Abfrage der Sicherung beim Start, einmal je Sitzung (StrictMode ruft Effekte doppelt auf). */
let recovery: Promise<unknown> | null = null;

export function App() {
  const theme = useStore((s) => s.ui.theme);
  const activePage = useStore((s) => s.project.pages.find((p) => p.id === s.ui.activePage) ?? null);
  const isStart = useStore((s) => s.ui.activePage === START_PAGE);
  const panelsHidden = useStore((s) => s.ui.panelsHidden);
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    recovery ??= Promise.all([offerRecovery(null), loadRecent()]);
    // Doppelklick-Dateien erst nach der Abfrage, damit eine Sicherung nicht ungefragt verworfen wird
    const stops = [startKeyboard(), startAutosave(), startWindowTitle(), guardClose(), startOpenedFiles(recovery)];
    return () => stops.forEach((stop) => stop());
  }, []);

  return (
    <div className={`app${isStart ? ' start' : ''}`}>
      <TabBar />
      {isStart || !activePage ? (
        <StartPage />
      ) : (
        <>
          {!panelsHidden && <ControlBar />}
          {!panelsHidden && <Toolbar />}
          <Canvas page={activePage} />
          {!panelsHidden && sidebarOpen && <Sidebar />}
        </>
      )}
      <TooltipHost />
      <Toasts />
      <PdfPagePicker />
      <RenumberDialog />
      <CategoryListDialog />
      <ExportDialog />
      <ExportProgress />
      <DialogHost />
      <ShortcutsOverlay />
      <StartScreen />
    </div>
  );
}
