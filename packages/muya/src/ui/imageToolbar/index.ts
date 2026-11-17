import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { Muya } from '../../index';

import type { IImageInfo } from '../../utils/image';
import type { IBaseOptions } from '../types';
import type { Icon } from './config';
import { SelectionType } from '../../selection/types';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import icons from './config';
import './index.css';

export interface IImageToolbarAction {
    id: string;
    label: string;
    enabled?: boolean;
    click: () => void;
}

export interface IImageToolbarOptions extends Partial<IBaseOptions> {
    /** The host owns clipboard permissions, file resolution, labels and error reporting. */
    getImageActions?: (image: HTMLImageElement) => IImageToolbarAction[];
}

const defaultOptions = {
    placement: 'top' as const,
    offsetOptions: {
        mainAxis: 10,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

export class ImageToolBar extends BaseFloat {
    static pluginName = 'imageToolbar';
    private _oldVNode: VNode | null = null;
    private _imageInfo: IImageInfo | null = null;

    private _icons: Icon[] = icons;
    private _reference: HTMLElement | null = null;
    private _getImageActions?: IImageToolbarOptions['getImageActions'];
    private _block: Format | null = null;
    private _toolbarContainer: HTMLDivElement = document.createElement('div');

    constructor(muya: Muya, options: IImageToolbarOptions = {}) {
        const name = 'mu-image-toolbar';
        const opts = Object.assign({}, defaultOptions, options);

        super(muya, name, opts);
        this._getImageActions = options.getImageActions;

        this.container!.appendChild(this._toolbarContainer);
        this.floatBox!.classList.add('mu-image-toolbar-container');

        this.listen();
    }

    override listen() {
        const { eventCenter } = this.muya;
        super.listen();
        eventCenter.on('selection-change', ({ selection }) => {
            const image = selection?.kind === SelectionType.IMAGE ? selection.context : null;
            if (this.muya.isReadOnly || !image?.domNode) {
                this.hide();
                return;
            }
            const { block, imageInfo, domNode } = image;
            this._block = block;
            this._imageInfo = imageInfo;
            this._reference = domNode;
            this.show(domNode);
            this._render();
        });
        eventCenter.attachDOMEvent(document, 'mousedown', (event) => {
            if (event.target instanceof Element && event.target.closest('.mu-transformer'))
                this.hide();
        });
    }

    private _render() {
        const { _icons: icons, _oldVNode: oldVNode, _toolbarContainer: toolbarContainer, _imageInfo: imageInfo } = this;
        const { i18n } = this.muya;
        const { attrs } = imageInfo!.token;
        const dataAlign = attrs?.['data-align'];
        const children = icons.map((i) => {
            const iconWrapperSelector = 'div.icon-wrapper';
            const icon = h(
                'i.icon',
                h(
                    'i.icon-inner',
                    {
                        style: {
                            'background': `url(${i.icon}) no-repeat`,
                            'background-size': '100%',
                        },
                    },
                    '',
                ),
            );
            const iconWrapper = h(iconWrapperSelector, icon);
            let itemSelector = `li.item.${i.type}`;

            if (i.type === dataAlign || (!dataAlign && i.type === 'inline'))
                itemSelector += '.active';

            return h(
                itemSelector,
                {
                    dataset: {
                        tip: i.tooltip,
                    },
                    attrs: {
                        title: i18n.t(i.tooltip),
                    },
                    on: {
                        click: (event) => {
                            this._selectItem(event, i);
                        },
                    },
                },
                iconWrapper,
            );
        });

        const image = this._reference?.querySelector('img');
        const actions = image ? this._getImageActions?.(image) ?? [] : [];
        const actionButtons = actions.map(action => h('button', {
            key: action.id,
            attrs: {
                'type': 'button',
                'title': action.label,
                'aria-label': action.label,
                'disabled': action.enabled === false,
            },
            on: {
                // Keep the image selected while a toolbar button receives the click.
                mousedown: event => event.preventDefault(),
                click: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (action.enabled !== false)
                        action.click();
                },
            },
        }, action.label));
        const vnode = h('div', [
            h('ul', children),
            ...(actionButtons.length ? [h('div.mu-image-copy-actions', actionButtons)] : []),
        ]);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(toolbarContainer, vnode);

        this._oldVNode = vnode;
    }

    private _selectItem(event: Event, item: Icon) {
        event.preventDefault();
        event.stopPropagation();

        const { _imageInfo: imageInfo } = this;

        switch (item.type) {
            // Delete image.
            case 'delete':
                this._block!.deleteImage(imageInfo!);

                return this.hide();

                // Edit image, for example: editor alt and title, replace image.
            case 'edit': {
                const rect = this._reference!.getBoundingClientRect();
                const reference = {
                    getBoundingClientRect() {
                        rect.height = 0;

                        return rect;
                    },
                };
                this.muya.ui.hideAllFloatTools();

                this.muya.eventCenter.emit('muya-image-selector', {
                    block: this._block,
                    reference,
                    imageInfo,
                });

                return this.hide();
            }

            case 'inline':
                // fall through
            case 'left':
                // fall through
            case 'center':
                // fall through
            case 'right': {
                this._block!.updateImage(this._imageInfo!, 'data-align', item.type);

                return this.hide();
            }
        }
    }
}
