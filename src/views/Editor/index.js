
import './index.scss'
import 'style-loader!vendor/stylesheets/typeahead.css'

import React from 'react'
import Loader from 'react-loader'
import {connect} from 'react-redux'
import {FormattedMessage, injectIntl, intlShape} from 'react-intl'
import {get, isEqual, keys} from 'lodash'
import PropTypes from 'prop-types'
import {Button} from 'material-ui'
import Tooltip from 'material-ui/Tooltip'
import Close from 'material-ui-icons/Close'
import {getStringWithLocale} from '../../utils/locale'
import {
    fetchEventForEditing as fetchEventForEditingAction,
    deleteEvent as deleteEventAction,
    cancelEvent as cancelEventAction,
    sendData as sendDataAction,
    clearData as clearDataAction,
    setValidationErrors as setValidationErrorsAction,
    setEditorAuthFlashMsg as setEditorAuthFlashMsgAction,
    setLanguages as setLanguageAction,
} from '../../actions/editor'
import {confirmAction, clearFlashMsg as clearFlashMsgAction} from '../../actions/app'
import {
    fetchSubEvents as fetchSubEventsAction,
    clearSubEvents as clearSubEventsAction,
} from '../../actions/subEvents'
import {
    clearEventDetails as clearEventDetailsAction,
    clearSuperEventDetails as clearSuperEventDetailsAction,
} from '../../actions/events'
import constants from '../../constants'
import {checkEventEditability} from '../../utils/checkEventEditability'
import FormFields from '../../components/FormFields'
import {mapUIDataToAPIFormat} from '../../utils/formDataMapping';
import {getConfirmationMarkup} from '../../utils/helpers'
import getContentLanguages from '../../utils/language'

// sentinel for authentication alert
let sentinel = true

export class EditorPage extends React.Component {
    constructor(props) {
        super(props)
        
        this.handler = (ev) => {
            ev.preventDefault();
            if (this.state.isDirty) {
                (ev || window.event).returnValue = null;
                this.state = {}
            }
        }
        this.state = {
            canSubmit: false,
            disabled: false,
            isDirty: false,
        }

        this.setDirtyState = this.setDirtyState.bind(this)
        this.clearEventData = this.clearEventData.bind(this)
        this.form = React.createRef()
    }

    componentDidMount() {
        window.addEventListener('beforeunload', this.handler)
        this.props.setEditorAuthFlashMsg()
        const params = get(this.props, ['match', 'params'])

        if(params.action === 'update' && params.eventId) {
            this.fetchEventData(params.eventId)
        }
    }

    componentDidUpdate(prevProps) {
        const prevParams = get(prevProps, ['match', 'params'], {})
        const currParams = get(this.props, ['match', 'params'], {})

        const {values, contentLanguages} = this.props.editor
        const newContentLanguages = getContentLanguages(values)

        // set correct content languages based on editor values
        if (newContentLanguages.length && !isEqual(newContentLanguages, contentLanguages)) {
            this.props.setLanguages(newContentLanguages)
        }

        // check if the editing mode or if the eventId params changed
        if (prevParams.action !== currParams.action || prevParams.eventId !== currParams.eventId) {
            currParams.action  === 'update'
                ? this.fetchEventData(currParams.eventId)
                : this.clearEventData()
        }
    }

    componentWillUnmount() {
        window.removeEventListener('beforeunload', this.handler)
        this.props.setValidationErrors({})
        this.props.clearFlashMsg()
        this.clearEventData()
    }

    fetchEventData(eventId) {
        const {fetchEventForEditing, fetchSubEvents, user} = this.props
        fetchEventForEditing(eventId, user)
        fetchSubEvents(eventId, user)
    }

    /**
     * Clears the editor data and the event, super event and sub events from the store
     */
    clearEventData() {
        const {clearData, clearEventDetails, clearSuperEventDetails, clearSubEvents} = this.props
        clearData()
        clearEventDetails()
        clearSuperEventDetails()
        clearSubEvents()
        
        // Reset the state of the HelDatePicker and HelTimePicker components
        this.form.current.refs.start_time.refs.date.resetDate();
        this.form.current.refs.start_time.resetTime();
        
        this.form.current.refs.end_time.refs.date.resetDate();
        this.form.current.refs.end_time.resetTime();
    }

    setDirtyState() {
        if (!this.state.isDirty) {
            this.setState({isDirty: true})
        }
    }

    enableButton() {
        return this.setState({
            canSubmit: true,
        });
    }

    disableButton() {
        return this.setState({
            canSubmit: false,
        });
    }

    getDeleteButton(disabled = false) {
        if(this.props.match.params.action === 'update') {
            return (
                <Button
                    raised
                    disabled={disabled}
                    onClick={ (e) => this.confirmDelete(e) }
                    color="accent"
                >
                    <FormattedMessage id="delete-events"/>
                </Button>
            )
        }
    }

    get getSubEvents() {
        return get(this.props, ['subEvents', 'items'], [])
    }

    eventExists() {
        if (this.props.match.params.action !== 'update') {
            // we are not updating an existing event
            return false
        }
        let publicationStatus = _.get(this.props, 'editor.values.publication_status')
        if (!publicationStatus) {
            // if the field is missing, the user is not logged in, so the event is public
            return true
        }
        if (publicationStatus === constants.PUBLICATION_STATUS.PUBLIC) {
            return true
        }
        // the publication status field exists and the event is not public
        return false
    }

    getCancelButton(disabled = false) {
        if(this.eventExists()) {
            return (
                <Button
                    raised
                    disabled={disabled}
                    onClick={ (e) => this.confirmCancel(e)}
                    color="accent"><FormattedMessage id="cancel-events"/></Button>
            )
        } else {
            return null
        }
    }

    getSaveButtons(disabled = false) {
        const eventExists = this.eventExists()
        const hasSubEvents = eventExists && this.getSubEvents.length > 0
        let labelTextId = this.props.editor.isSending
            ? (eventExists ? 'event-action-save-existing-active' : 'event-action-save-new-active')
            : (eventExists ? 'event-action-save-existing' : 'event-action-save-new')

        if (_.keys(this.props.editor.values.sub_events).length > 0 && !eventExists) {
            labelTextId = this.props.editor.isSending ? 'event-action-save-multiple-active' : 'event-action-save-multiple'
        }

        return (
            <Button
                raised
                color="primary"
                disabled={disabled}
                onClick={ (e) => hasSubEvents ? this.confirmUpdate() : this.saveAsPublished(e) }
            ><FormattedMessage id={labelTextId}/></Button>
        )
    }

    getActionButtons() {
        let {eventIsEditable, eventEditabilityExplanation} = checkEventEditability(this.props.user, this.props.editor.values)
    
        let disabled = this.props.editor.isSending || !eventIsEditable
        let buttons = (
            <div className="actions">
                <div>
                    {this.getDeleteButton(disabled)}
                    {this.getCancelButton(disabled)}
                </div>
                {this.getSaveButtons(disabled)}
            </div>
        )
        return (
            <div className='buttons-group'>
                {eventIsEditable ? buttons :
                    <Tooltip title={eventEditabilityExplanation}>
                        <span>{buttons}</span>
                    </Tooltip>
                }
            </div>
        )
    }

    saveAsDraft(event) {
        let doUpdate = this.props.match.params.action === 'update'
        this.setState({isDirty: false})
        this.props.sendData(doUpdate, constants.PUBLICATION_STATUS.DRAFT)
    }

    saveAsPublished(event) {
        let doUpdate = this.props.match.params.action === 'update'
        this.setState({isDirty: false})
        this.props.sendData(doUpdate, constants.PUBLICATION_STATUS.PUBLIC)
    }

    confirmUpdate() {
        this.props.confirm(
            'confirm-update',
            'message',
            'save',
            {
                action: () => this.saveAsPublished(),
                additionalMsg: getStringWithLocale(this.props, 'editor.values.name', 'fi'),
                additionalMarkup: getConfirmationMarkup('update', this.props.intl, this.getSubEvents),
            }
        )
    }

    confirmDelete() {
        // TODO: maybe do a decorator for confirmable actions etc...?
        const {user, deleteEvent, editor} = this.props;
        const eventId = this.props.match.params.eventId;

        this.props.confirm(
            'confirm-delete',
            'warning',
            'delete-events',
            {
                action: () => deleteEvent(eventId, user, editor.values),
                additionalMsg: getStringWithLocale(this.props, 'editor.values.name', 'fi'),
                additionalMarkup: getConfirmationMarkup('delete', this.props.intl, this.getSubEvents),
            }
        )
    }

    confirmCancel() {
        // TODO: maybe do a decorator for confirmable actions etc...?
        const {user, editor,cancelEvent} = this.props;
        const eventId = this.props.match.params.eventId;

        this.props.confirm(
            'confirm-cancel',
            'warning',
            'cancel-events',
            {
                action: () => cancelEvent(eventId, user, mapUIDataToAPIFormat(editor.values)),
                additionalMsg: getStringWithLocale(this.props, 'editor.values.name', 'fi'),
                additionalMarkup: getConfirmationMarkup('cancel', this.props.intl, this.getSubEvents),
            }
        )
    }

    render() {
        const {editor, user, match, organizations, intl} = this.props
        const headerTextId = match.params.action === 'update'
            ? `edit-${appSettings.ui_mode}`
            : `create-${appSettings.ui_mode}`
        let clearButton = null

        if (keys(editor.values).length) {
            clearButton = (
                <Button
                    raised
                    onClick={this.clearEventData}
                    color="primary"
                    className="pull-right"
                >
                    <FormattedMessage id="clear-form"/> <Close/>
                </Button>
            )
        }

        // TODO: fix flow for non-authorized users
        if (user && !user.organization && sentinel) {
            setTimeout(() => alert(intl.formatMessage({id:'editor-sentinel-alert'})), 1000);
            sentinel = false;
        }

        return (
            <div className="editor-page">
                <div className="container header">
                    <h1>
                        <FormattedMessage id={headerTextId}/>
                    </h1>
                    <span className="controls">
                        {clearButton}
                    </span>
                </div>

                <div className="container">
                    <FormFields
                        ref={this.form}
                        action={match.params.action}
                        editor={editor}
                        organizations={organizations}
                        setDirtyState={this.setDirtyState}
                    />
                </div>

                <div className="editor-action-buttons">
                    <div className="container">
                        <div className="row">
                            <Loader loaded={!editor.isSending} scale={1}/>
                            {this.getActionButtons()}
                        </div>
                    </div>
                </div>
            </div>
        )
    }
}

const mapStateToProps = (state) => ({
    editor: state.editor,
    subEvents: state.subEvents,
    user: state.user,
    organizations: state.organizations.admin,
})

const mapDispatchToProps = (dispatch) => ({
    fetchEventForEditing: (eventId, user) => dispatch(fetchEventForEditingAction(eventId, user)),
    fetchSubEvents: (eventId, user) => dispatch(fetchSubEventsAction(eventId, user)),
    clearData: () => dispatch(clearDataAction()),
    clearEventDetails: () => dispatch(clearEventDetailsAction()),
    clearSuperEventDetails: () => dispatch(clearSuperEventDetailsAction()),
    clearSubEvents: () => dispatch(clearSubEventsAction()),
    setValidationErrors: (errors) => dispatch(setValidationErrorsAction(errors)),
    setEditorAuthFlashMsg: () => dispatch(setEditorAuthFlashMsgAction()),
    setLanguages: (languages) => dispatch(setLanguageAction(languages)),
    clearFlashMsg: () => dispatch(clearFlashMsgAction()),
    sendData: (updateExisting, publicationStatus) =>
        dispatch(sendDataAction(updateExisting, publicationStatus)),
    confirm: (msg, style, actionButtonLabel, data) => dispatch(confirmAction(msg, style, actionButtonLabel, data)),
    deleteEvent: (eventId, user, values) => dispatch(deleteEventAction(eventId, user, values)),
    cancelEvent: (eventId, user, values) => dispatch(cancelEventAction(eventId, user, values)),
})

EditorPage.propTypes = {
    match: PropTypes.object,
    fetchEventForEditing: PropTypes.func,
    fetchSubEvents: PropTypes.func,
    setValidationErrors: PropTypes.func,
    setEditorAuthFlashMsg: PropTypes.func,
    setLanguages: PropTypes.func,
    clearFlashMsg: PropTypes.func,
    clearData: PropTypes.func,
    clearEventDetails: PropTypes.func,
    clearSuperEventDetails: PropTypes.func,
    clearSubEvents: PropTypes.func,
    user: PropTypes.object,
    editor: PropTypes.object,
    subEvents: PropTypes.object,
    sendData: PropTypes.func,
    confirm: PropTypes.func,
    deleteEvent: PropTypes.func,
    cancelEvent: PropTypes.func,
    intl: intlShape.isRequired,
    organizations: PropTypes.arrayOf(PropTypes.object),
}
export default connect(mapStateToProps, mapDispatchToProps)(injectIntl(EditorPage))
