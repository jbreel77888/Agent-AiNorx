export type ToolIconKey =
  | 'globe' | 'file-edit' | 'file-search' | 'file-plus' | 'file-text' | 'file-x'
  | 'list' | 'list-todo' | 'terminal' | 'computer' | 'search' | 'external-link'
  | 'network' | 'table' | 'code' | 'phone' | 'phone-off' | 'message-question'
  | 'check-circle' | 'wrench' | 'book-open' | 'plug' | 'clock'
  | 'presentation' | 'image' | 'pencil' | 'hammer';

const TOOL_ICON_MAP: Record<string, ToolIconKey> = {
  'browser_action': 'globe',
  'web_search': 'search',
  'create_file': 'file-plus',
  'read_file': 'file-text',
  'str_replace_editor': 'file-edit',
  'delete_file': 'file-x',
  'execute_command': 'terminal',
  'list_directory': 'list',
  'task_list': 'list-todo',
  'sb-computer-use': 'computer',
  'expose_port': 'external-link',
  'ask_user': 'message-question',
  'complete': 'check-circle',
  'vapi_make_call': 'phone',
  'vapi_end_call': 'phone-off',
  'create_presentation': 'presentation',
  'generate_image': 'image',
  'designer_tool': 'pencil',
  'mcp_tool': 'plug',
  'wait': 'clock',
};

export function getToolIconKey(toolName: string | undefined): ToolIconKey {
  if (!toolName) return 'wrench';
  return TOOL_ICON_MAP[toolName] || 'wrench';
}
