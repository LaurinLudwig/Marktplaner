/** Lokal gebündelte Material Symbols (Outlined, 400). Nichts wird von Google-Servern geladen. */
import i_select from '@material-symbols/svg-400/outlined/arrow_selector_tool.svg?raw';
import i_hand from '@material-symbols/svg-400/outlined/pan_tool.svg?raw';
import i_zoom from '@material-symbols/svg-400/outlined/zoom_in.svg?raw';
import i_zoomOut from '@material-symbols/svg-400/outlined/zoom_out.svg?raw';
import i_area from '@material-symbols/svg-400/outlined/rectangle.svg?raw';
import i_stand from '@material-symbols/svg-400/outlined/storefront.svg?raw';
import i_infra from '@material-symbols/svg-400/outlined/fence.svg?raw';
import i_measure from '@material-symbols/svg-400/outlined/straighten.svg?raw';
import i_calibrate from '@material-symbols/svg-400/outlined/square_foot.svg?raw';
import i_titleBlock from '@material-symbols/svg-400/outlined/text_fields.svg?raw';
import i_snapFront from '@material-symbols/svg-400/outlined/border_bottom.svg?raw';
import i_snapGrid from '@material-symbols/svg-400/outlined/grid_4x4.svg?raw';
import i_snapNeighbors from '@material-symbols/svg-400/outlined/align_justify_space_even.svg?raw';
import i_grid from '@material-symbols/svg-400/outlined/grid_on.svg?raw';
import i_menu from '@material-symbols/svg-400/outlined/menu.svg?raw';
import i_add from '@material-symbols/svg-400/outlined/add.svg?raw';
import i_close from '@material-symbols/svg-400/outlined/close.svg?raw';
import i_sidebarClose from '@material-symbols/svg-400/outlined/right_panel_close.svg?raw';
import i_sidebarOpen from '@material-symbols/svg-400/outlined/right_panel_open.svg?raw';
import i_keyboard from '@material-symbols/svg-400/outlined/keyboard.svg?raw';
import i_darkMode from '@material-symbols/svg-400/outlined/dark_mode.svg?raw';
import i_lightMode from '@material-symbols/svg-400/outlined/light_mode.svg?raw';
import i_save from '@material-symbols/svg-400/outlined/save.svg?raw';
import i_open from '@material-symbols/svg-400/outlined/folder_open.svg?raw';
import i_new from '@material-symbols/svg-400/outlined/note_add.svg?raw';
import i_undo from '@material-symbols/svg-400/outlined/undo.svg?raw';
import i_redo from '@material-symbols/svg-400/outlined/redo.svg?raw';
import i_fit from '@material-symbols/svg-400/outlined/fit_screen.svg?raw';
import i_copy from '@material-symbols/svg-400/outlined/content_copy.svg?raw';
import i_edit from '@material-symbols/svg-400/outlined/edit.svg?raw';
import i_delete from '@material-symbols/svg-400/outlined/delete.svg?raw';
import i_home from '@material-symbols/svg-400/outlined/home.svg?raw';
import i_visible from '@material-symbols/svg-400/outlined/visibility.svg?raw';
import i_hidden from '@material-symbols/svg-400/outlined/visibility_off.svg?raw';
import i_lock from '@material-symbols/svg-400/outlined/lock.svg?raw';
import i_unlock from '@material-symbols/svg-400/outlined/lock_open.svg?raw';
import i_colorReset from '@material-symbols/svg-400/outlined/format_color_reset.svg?raw';
import i_bolt from '@material-symbols/svg-400/outlined/bolt.svg?raw';
import i_up from '@material-symbols/svg-400/outlined/keyboard_arrow_up.svg?raw';
import i_down from '@material-symbols/svg-400/outlined/keyboard_arrow_down.svg?raw';
import i_center from '@material-symbols/svg-400/outlined/my_location.svg?raw';
import i_jump from '@material-symbols/svg-400/outlined/zoom_in_map.svg?raw';
import i_warning from '@material-symbols/svg-400/outlined/warning.svg?raw';
import i_filter from '@material-symbols/svg-400/outlined/filter_list.svg?raw';
import i_columns from '@material-symbols/svg-400/outlined/view_column.svg?raw';
import i_download from '@material-symbols/svg-400/outlined/download.svg?raw';
import i_search from '@material-symbols/svg-400/outlined/search.svg?raw';
import i_sortUp from '@material-symbols/svg-400/outlined/arrow_upward.svg?raw';
import i_sortDown from '@material-symbols/svg-400/outlined/arrow_downward.svg?raw';
import i_refresh from '@material-symbols/svg-400/outlined/refresh.svg?raw';

const RAW = {
  select: i_select,
  hand: i_hand,
  zoom: i_zoom,
  zoomOut: i_zoomOut,
  area: i_area,
  stand: i_stand,
  infra: i_infra,
  measure: i_measure,
  calibrate: i_calibrate,
  titleBlock: i_titleBlock,
  snapFront: i_snapFront,
  snapGrid: i_snapGrid,
  snapNeighbors: i_snapNeighbors,
  grid: i_grid,
  menu: i_menu,
  add: i_add,
  close: i_close,
  sidebarClose: i_sidebarClose,
  sidebarOpen: i_sidebarOpen,
  keyboard: i_keyboard,
  darkMode: i_darkMode,
  lightMode: i_lightMode,
  save: i_save,
  open: i_open,
  new: i_new,
  undo: i_undo,
  redo: i_redo,
  fit: i_fit,
  copy: i_copy,
  edit: i_edit,
  delete: i_delete,
  home: i_home,
  visible: i_visible,
  hidden: i_hidden,
  lock: i_lock,
  unlock: i_unlock,
  colorReset: i_colorReset,
  bolt: i_bolt,
  up: i_up,
  down: i_down,
  center: i_center,
  jump: i_jump,
  warning: i_warning,
  filter: i_filter,
  columns: i_columns,
  download: i_download,
  search: i_search,
  sortUp: i_sortUp,
  sortDown: i_sortDown,
  refresh: i_refresh,
};

export type IconName = keyof typeof RAW;

/** Nur der Inhalt des <svg>-Elements, damit Größe und Farbe von außen kommen. */
const INNER = Object.fromEntries(
  Object.entries(RAW).map(([k, svg]) => [k, /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1] ?? '']),
) as Record<IconName, string>;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: INNER[name] }}
    />
  );
}
