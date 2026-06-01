export type ID = string;
export type View = 'board' | 'calendar' | 'timeline';
export type ActivityType = 'created' | 'moved' | 'updated' | 'deleted' | 'due_set';
export type Priority = 'low' | 'medium' | 'high';
export type StoreName = 'boards' | 'columns' | 'cards' | 'settings' | 'activity' | 'boardCreds' | 'crdtOps';

export interface Board {
  id: ID;
  name: string;
  createdAt: number;
}

export interface Column {
  id: ID;
  boardId: ID;
  name: string;
  order: number;
  color: string;
}

export interface Card {
  id: ID;
  boardId: ID;
  columnId: ID | null;
  title: string;
  desc: string;
  tags: string[];
  color: string;
  priority: Priority;
  dueDate: string | null;
  order: number;
  createdAt: number;
}

export interface ActivityEvent {
  id: ID;
  boardId: ID;
  cardId: ID;
  type: ActivityType;
  ts: number;
  cardTitle?: string;
  fromColId?: ID | null;
  toColId?: ID | null;
  fromColName?: string;
  toColName?: string;
  dueDate?: string | null;
}

export interface BoardCred {
  boardId: ID;
  keyHash: string;
  name: string;
  lastSynced: number | null;
}

export interface CrdtOp {
  opId: ID;
  type: string;
  ts: number;
  clientId: string;
  boardId: ID;
  payload: Record<string, unknown>;
}

export interface ThemeDef {
  id: string;
  label: string;
  section: 'dark' | 'light';
  bg: string;
  surface: string;
  accent: string;
  accent2: string;
  dot3: string;
}

export interface Toast {
  id: ID;
  message: string;
  icon: string;
}

export interface ModalState {
  type: string;
  props?: Record<string, unknown>;
}

export interface FlowState {
  boards: Board[];
  columns: Column[];
  cards: Card[];
  activity: ActivityEvent[];
  activeBoardId: string | null;
  activeView: View;
  activeTheme: string;
  backlogOpen: boolean;
  searchQuery: string;
  showDueDateOnly: boolean;
  calendarDate: Date;
  modal: ModalState | null;
  toasts: Toast[];
  workerStatus: boolean;
  workerUrl: string;
  syncInterval: number;
  isLoading: boolean;
  error: string | null;

  init: () => Promise<void>;
  setActiveBoard: (id: string | null) => Promise<void>;
  setActiveView: (view: View) => void;
  setSearchQuery: (q: string) => void;
  toggleBacklog: () => Promise<void>;
  toggleDueDateOnly: () => void;
  setCalendarDate: (d: Date) => void;
  openModal: (type: string, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  toast: (message: string, icon?: string) => void;
  createBoard: (name: string, password: string) => Promise<void>;
  renameBoard: (id: string, name: string) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;
  createColumn: (boardId: string, name: string) => Promise<void>;
  updateColumn: (id: string, updates: Partial<Column>) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  createCard: (boardId: string, columnId: string | null, data: Partial<Card>) => Promise<void>;
  updateCard: (id: string, updates: Partial<Card>) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (cardId: string, targetColumnId: string | null, targetIndex: number) => Promise<void>;
  reorderColumns: (orderedIds: string[]) => Promise<void>;
  saveTheme: (id: string) => Promise<void>;
  saveSettings: (settings: { workerUrl: string; syncInterval: number }) => Promise<void>;
  joinBoard: (boardId: string, password: string) => Promise<boolean>;
  exportData: () => void;
  importData: (json: string) => Promise<void>;
  applyCrdtOp: (op: CrdtOp, clientId: string) => boolean;
}
