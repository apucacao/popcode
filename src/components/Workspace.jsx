import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import get from 'lodash/get';
import values from 'lodash/values';
import bindAll from 'lodash/bindAll';
import includes from 'lodash/includes';
import isNull from 'lodash/isNull';
import partial from 'lodash/partial';
import sortBy from 'lodash/sortBy';
import map from 'lodash/map';
import isError from 'lodash/isError';
import isString from 'lodash/isString';
import {t} from 'i18next';
import qs from 'qs';
import Bugsnag from '../util/Bugsnag';
import {
  onSignedIn,
  onSignedOut,
  signIn,
  signOut,
  startSessionHeartbeat,
} from '../clients/firebaseAuth';

import {
  addRuntimeError,
  changeCurrentProject,
  clearRuntimeErrors,
  createProject,
  updateProjectSource,
  userAuthenticated,
  userLoggedOut,
  toggleLibrary,
  hideComponent,
  unhideComponent,
  toggleDashboard,
  toggleDashboardSubmenu,
  userRequestedFocusedLine,
  editorFocusedRequestedLine,
  editorsUpdateVerticalFlex,
  notificationTriggered,
  userDismissedNotification,
  exportGist,
  applicationLoaded,
} from '../actions';

import {getCurrentProject, isPristineProject} from '../util/projectUtils';

import EditorsColumn from './EditorsColumn';
import Output from './Output';
import Sidebar from './Sidebar';
import Dashboard from './Dashboard';
import NotificationList from './NotificationList';
import PopThrobber from './PopThrobber';

function mapStateToProps(state) {
  const projects = sortBy(
    values(state.get('projects').toJS()),
    project => -project.updatedAt,
  );

  return {
    allProjects: projects,
    currentProject: getCurrentProject(state),
    errors: state.get('errors').toJS(),
    runtimeErrors: state.get('runtimeErrors').toJS(),
    isUserTyping: state.getIn(['ui', 'editors', 'typing']),
    editorsFlex: state.getIn(['ui', 'editors', 'verticalFlex']).toJS(),
    currentUser: state.get('user').toJS(),
    ui: state.get('ui').toJS(),
    clients: state.get('clients').toJS(),
  };
}

class Workspace extends React.Component {
  constructor() {
    super();
    bindAll(
      this,
      '_confirmUnload',
      '_handleClearRuntimeErrors',
      '_handleComponentUnhide',
      '_handleComponentHide',
      '_handleDashboardSubmenuToggled',
      '_handleEditorInput',
      '_handleEditorsUpdateVerticalFlex',
      '_handleErrorClick',
      '_handleLibraryToggled',
      '_handleLogOut',
      '_handleNewProject',
      '_handleProjectSelected',
      '_handleRuntimeError',
      '_handleStartLogIn',
      '_handleToggleDashboard',
      '_handleRequestedLineFocused',
      '_handleNotificationDismissed',
      '_handleExportGist',
    );
  }

  componentWillMount() {
    let gistId;
    if (location.search) {
      const query = qs.parse(location.search.slice(1));
      gistId = query.gist;
    }
    history.replaceState({}, '', location.pathname);
    this.props.dispatch(applicationLoaded(gistId));
    this._listenForAuthChange();
    startSessionHeartbeat();
  }

  componentDidMount() {
    addEventListener('beforeunload', this._confirmUnload);
  }

  componentWillUnmount() {
    removeEventListener('beforeunload', this._confirmUnload);
  }

  _confirmUnload(event) {
    if (!this.props.currentUser.authenticated) {
      const currentProject = this.props.currentProject;
      if (!isNull(currentProject) && !isPristineProject(currentProject)) {
        event.returnValue = t('workspace.confirmations.unload-unsaved');
      }
    }
  }

  _handleComponentHide(componentName) {
    this.props.dispatch(
      hideComponent(
        this.props.currentProject.projectKey,
        componentName,
      ),
    );
  }

  _handleComponentUnhide(componentName) {
    this.props.dispatch(
      unhideComponent(
        this.props.currentProject.projectKey,
        componentName,
      ),
    );
  }

  _handleErrorClick(language, line, column) {
    this.props.dispatch(unhideComponent(`editor.${language}`));
    this.props.dispatch(userRequestedFocusedLine(language, line, column));
  }

  _handleEditorInput(language, source) {
    this.props.dispatch(
      updateProjectSource(
        this.props.currentProject.projectKey,
        language,
        source,
      ),
    );
  }

  _handleLibraryToggled(libraryKey) {
    this.props.dispatch(
      toggleLibrary(
        this.props.currentProject.projectKey,
        libraryKey,
      ),
    );
  }

  _handleNewProject() {
    this.props.dispatch(createProject());
  }

  _handleProjectSelected(project) {
    this.props.dispatch(changeCurrentProject(project.projectKey));
  }

  _handleDashboardSubmenuToggled(submenu) {
    this.props.dispatch(toggleDashboardSubmenu(submenu));
  }

  _handleRuntimeError(error) {
    this.props.dispatch(addRuntimeError(error));
  }

  _handleClearRuntimeErrors() {
    this.props.dispatch(clearRuntimeErrors());
  }

  _getOverallValidationState() {
    const errorStates = map(values(this.props.errors), 'state');

    if (includes(errorStates, 'failed')) {
      if (this.props.isUserTyping) {
        return 'validating';
      }
      return 'failed';
    }

    if (includes(errorStates, 'validating')) {
      return 'validating';
    }

    return 'passed';
  }

  _renderOutput() {
    const {hiddenUIComponents} = this.props.currentProject;
    return (
      <Output
        errors={this.props.errors}
        isHidden={includes(hiddenUIComponents, 'output')}
        project={this.props.currentProject}
        runtimeErrors={this.props.runtimeErrors}
        validationState={this._getOverallValidationState()}
        onClearRuntimeErrors={this._handleClearRuntimeErrors}
        onErrorClick={this._handleErrorClick}
        onHide={
          partial(this._handleComponentHide,
            'output')
        }
        onRuntimeError={this._handleRuntimeError}
      />
    );
  }

  _handleToggleDashboard() {
    this.props.dispatch(toggleDashboard());
  }

  _handleEditorsUpdateVerticalFlex(data) {
    this.props.dispatch(editorsUpdateVerticalFlex(data));
  }

  _listenForAuthChange() {
    onSignedIn(userCredential =>
      this.props.dispatch(userAuthenticated(userCredential)),
    );
    onSignedOut(() => this.props.dispatch(userLoggedOut()));
  }

  _handleStartLogIn() {
    signIn().catch((e) => {
      switch (e.code) {
        case 'auth/popup-closed-by-user':
          this.props.dispatch(notificationTriggered('user-cancelled-auth'));
          break;
        case 'auth/network-request-failed':
          this.props.dispatch(notificationTriggered('auth-network-error'));
          break;
        case 'auth/cancelled-popup-request':
          break;
        case 'auth/web-storage-unsupported':
          this.props.dispatch(
            notificationTriggered('auth-third-party-cookies-disabled'),
          );
          break;
        default:
          this.props.dispatch(notificationTriggered('auth-error'));
          if (isError(e)) {
            Bugsnag.notifyException(e, e.code);
          } else if (isString(e)) {
            Bugsnag.notifyException(new Error(e));
          }
          break;
      }
    });
  }

  _handleNotificationDismissed(error) {
    this.props.dispatch(userDismissedNotification(error.type));
  }

  _handleLogOut() {
    signOut();
  }

  _handleRequestedLineFocused() {
    this.props.dispatch(editorFocusedRequestedLine());
  }

  _handleExportGist() {
    this.props.dispatch(exportGist());
  }

  _renderDashboard() {
    if (!this.props.ui.dashboard.isOpen) {
      return null;
    }

    return (
      <div className="layout__dashboard">
        <Dashboard
          activeSubmenu={this.props.ui.dashboard.activeSubmenu}
          allProjects={this.props.allProjects}
          currentProject={this.props.currentProject}
          currentUser={this.props.currentUser}
          gistExportInProgress={
            get(this.props, 'clients.gists.lastExport.status') === 'waiting'
          }
          validationState={this._getOverallValidationState()}
          onExportGist={this._handleExportGist}
          onLibraryToggled={this._handleLibraryToggled}
          onLogOut={this._handleLogOut}
          onNewProject={this._handleNewProject}
          onProjectSelected={this._handleProjectSelected}
          onStartLogIn={this._handleStartLogIn}
          onSubmenuToggled={this._handleDashboardSubmenuToggled}
        />
      </div>
    );
  }

  _renderSidebar() {
    let hiddenComponents = [];
    if (!isNull(this.props.currentProject)) {
      hiddenComponents = this.props.currentProject.hiddenUIComponents;
    }
    return (
      <div className="layout__sidebar">
        <Sidebar
          dashboardIsOpen={this.props.ui.dashboard.isOpen}
          hiddenComponents={hiddenComponents}
          validationState={this._getOverallValidationState()}
          onComponentUnhide={this._handleComponentUnhide}
          onToggleDashboard={this._handleToggleDashboard}
        />
      </div>
    );
  }

  _renderEnvironment() {
    const {currentProject} = this.props;
    if (isNull(currentProject)) {
      return <PopThrobber message={t('workspace.loading')} />;
    }

    return (
      <div className="environment">
        <EditorsColumn
          currentProject={currentProject}
          editorsFlex={this.props.editorsFlex}
          errors={this.props.errors}
          runtimeErrors={this.props.runtimeErrors}
          ui={this.props.ui}
          onComponentHide={this._handleComponentHide}
          onEditorInput={this._handleEditorInput}
          onRequestedLineFocused={this._handleRequestedLineFocused}
          onUpdateFlex={this._handleEditorsUpdateVerticalFlex}
        />
        {this._renderOutput()}
      </div>
    );
  }

  render() {
    return (
      <div>
        <NotificationList
          notifications={this.props.ui.notifications}
          onErrorDismissed={this._handleNotificationDismissed}
        />
        <div className="layout">
          {this._renderDashboard()}
          {this._renderSidebar()}
          <div className="workspace layout__main">
            {this._renderEnvironment()}
          </div>
        </div>
      </div>
    );
  }
}

Workspace.propTypes = {
  allProjects: PropTypes.array.isRequired,
  clients: PropTypes.object.isRequired,
  currentProject: PropTypes.object,
  currentUser: PropTypes.object.isRequired,
  dispatch: PropTypes.func.isRequired,
  editorsFlex: PropTypes.array.isRequired,
  errors: PropTypes.object.isRequired,
  isUserTyping: PropTypes.bool,
  runtimeErrors: PropTypes.array.isRequired,
  ui: PropTypes.object.isRequired,
};

Workspace.defaultProps = {
  currentProject: null,
  isUserTyping: false,
};

export default connect(mapStateToProps)(Workspace);
