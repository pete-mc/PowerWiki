export interface HeaderMenuAction {
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
  readonly onClick: () => void;
}
