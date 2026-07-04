export interface RouteConfig {
  login: string;
  workbench: string;
  connectorParameters: string;
  settings: string;
}

export const Routes: RouteConfig = {
  login: 'pages/LoginPage',
  workbench: 'pages/WorkbenchPage',
  connectorParameters: 'pages/ConnectorParametersPage',
  settings: 'pages/SettingsPage'
};
