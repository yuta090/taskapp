export interface PortalVisibleSections {
  tasks: boolean
  requests: boolean
  all_tasks: boolean
  files: boolean
  meetings: boolean
  wiki: boolean
  history: boolean
}

export const DEFAULT_PORTAL_SECTIONS: PortalVisibleSections = {
  tasks: true,
  requests: true,
  all_tasks: true,
  files: true,
  meetings: true,
  wiki: false,
  history: true,
}
