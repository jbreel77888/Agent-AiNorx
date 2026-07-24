/**
 * Backwards-compat alias. The component was renamed from AddToProjectDialog
 * to InstallItemDialog when we migrated from project-scoped to account-scoped
 * installs. Old imports still work via this re-export.
 */
export { InstallItemDialog as AddToProjectDialog } from './install-item-dialog';
