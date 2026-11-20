// The Team tab's panels. The viewer loads this module on its own, off the critical path, and shows its
// panels only once it is in. A later task fills them in; until then each panel is empty.
export function gamePanel(game) {
  return [];
}

export function seasonPanel(stats) {
  return [];
}
