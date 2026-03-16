<template lang='pug'>
  .editor-ckeditor
    div(ref='toolbarContainer')
    div.contents(ref='editor')
    v-system-bar.editor-ckeditor-sysbar(dark, status, color='grey darken-3')
      .caption.editor-ckeditor-sysbar-locale {{locale.toUpperCase()}}
      .caption.px-3 /{{path}}
      template(v-if='$vuetify.breakpoint.mdAndUp')
        v-spacer
        .caption Visual Editor
        v-spacer
        .caption {{$t('editor:ckeditor.stats', { chars: stats.characters, words: stats.words })}}
    editor-conflict(v-model='isConflict', v-if='isConflict')
    page-selector(mode='select', v-model='insertLinkDialog', :open-handler='insertLinkHandler', :path='path', :locale='locale')
    editor-modal-drawio-visual(@diagram-ready='onDiagramReady', ref='drawioModal')
</template>

<script>
import _ from 'lodash'
import { get, sync } from 'vuex-pathify'
import DecoupledEditor from '@requarks/ckeditor5'
// import DecoupledEditor from '../../../../wiki-ckeditor5/build/ckeditor'
import EditorConflict from './ckeditor/conflict.vue'
import EditorModalDrawioVisual from './EditorModalDrawioVisual.vue'
import { html as beautify } from 'js-beautify/js/lib/beautifier.min.js'

/* global siteLangs */

export default {
  components: {
    EditorConflict,
    EditorModalDrawioVisual
  },
  props: {
    save: {
      type: Function,
      default: () => {}
    }
  },
  data() {
    return {
      editor: null,
      stats: {
        characters: 0,
        words: 0
      },
      content: '',
      isConflict: false,
      insertLinkDialog: false
    }
  },
  computed: {
    isMobile() {
      return this.$vuetify.breakpoint.smAndDown
    },
    locale: get('page/locale'),
    path: get('page/path'),
    activeModal: sync('editor/activeModal')
  },
  methods: {
    insertLink () {
      this.insertLinkDialog = true
    },
    insertLinkHandler ({ locale, path }) {
      this.editor.execute('link', siteLangs.length > 0 ? `/${locale}/${path}` : `/${path}`)
    },
    openDrawioModal () {
      window.dispatchEvent(new CustomEvent('editor:openDrawio', {
        detail: null
      }))
    },
    onDiagramReady (payload) {
      // Convert SVG base64 to data URL
      const svgDataUrl = `data:image/svg+xml;base64,${payload.svg}`

      // Insert or update the diagram
      const model = this.editor.model
      model.change(writer => {
        const selection = model.document.selection
        const selectedElement = selection.getSelectedElement()

        // Check if we're editing an existing diagram
        if (selectedElement && selectedElement.name === 'imageBlock' && selectedElement.getAttribute('data-drawio-xml')) {
          // Update existing diagram
          writer.setAttribute('src', svgDataUrl, selectedElement)
          writer.setAttribute('data-drawio-xml', payload.xml, selectedElement)
        } else {
          // Insert new diagram using the existing imageInsert command
          this.editor.execute('imageInsert', {
            source: svgDataUrl
          })

          // Find the newly inserted image and add the draw.io XML attribute
          const insertedImage = selection.getSelectedElement()
          if (insertedImage && insertedImage.name === 'imageBlock') {
            writer.setAttribute('data-drawio-xml', payload.xml, insertedImage)
          }
        }
      })
    },
    initDrawioSupport () {
      const editor = this.editor

      // Extend schema to support data-drawio-xml attribute on images
      editor.model.schema.extend('imageBlock', {
        allowAttributes: ['data-drawio-xml']
      })

      // Conversion from model to view (downcast - for editing and data output)
      editor.conversion.for('downcast').add(dispatcher => {
        dispatcher.on('attribute:data-drawio-xml:imageBlock', (evt, data, conversionApi) => {
          if (!data.item.is('element', 'imageBlock')) {
            return
          }

          const viewWriter = conversionApi.writer
          const viewElement = conversionApi.mapper.toViewElement(data.item)

          if (data.attributeNewValue !== null) {
            viewWriter.setAttribute('data-drawio-xml', data.attributeNewValue, viewElement)
          } else {
            viewWriter.removeAttribute('data-drawio-xml', viewElement)
          }
        })
      })

      // Conversion from view to model (upcast - for data loading)
      editor.conversion.for('upcast').attributeToAttribute({
        view: 'data-drawio-xml',
        model: 'data-drawio-xml'
      })

      // Add a custom button to the toolbar
      const toolbar = this.$refs.toolbarContainer.querySelector('.ck-toolbar')
      if (toolbar) {
        const button = document.createElement('button')
        button.className = 'ck ck-button ck-off'
        button.type = 'button'
        button.title = 'Insert Diagram'
        button.innerHTML = `
          <svg class="ck ck-icon ck-button__icon" viewBox="0 0 20 20">
            <path d="M3 6v3h4V6H3zm0 4v3h4v-3H3zm0 4v3h4v-3H3zm5 3h4v-3H8v3zm5 0h4v-3h-4v3zm4-4v-3h-4v3h4zm0-4V6h-4v3h4zm1.5 8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 17V4c.222-.863 1.068-1.5 2-1.5h13c.932 0 1.778.637 2 1.5v13zM12 13v-3H8v3h4zm0-4V6H8v3h4z"/>
          </svg>
        `
        button.addEventListener('click', () => {
          this.openDrawioModal()
        })

        // Insert after the imageUpload button if it exists, otherwise at the end
        const imageUploadBtn = toolbar.querySelector('[data-cke-tooltip-text*="image" i], [data-cke-tooltip-text*="Insert" i]')
        if (imageUploadBtn && imageUploadBtn.parentNode) {
          imageUploadBtn.parentNode.insertBefore(button, imageUploadBtn.nextSibling)
        } else {
          toolbar.appendChild(button)
        }
      }
    }
  },
  async mounted () {
    this.$store.set('editor/editorKey', 'ckeditor')

    this.editor = await DecoupledEditor.create(this.$refs.editor, {
      language: this.locale,
      placeholder: 'Type the page content here',
      disableNativeSpellChecker: false,
      // TODO: Mention autocomplete
      //
      // mention: {
      //   feeds: [
      //     {
      //       marker: '@',
      //       feed: [ '@Barney', '@Lily', '@Marshall', '@Robin', '@Ted' ],
      //       minimumCharacters: 1
      //     }
      //   ]
      // },
      wordCount: {
        onUpdate: stats => {
          this.stats = {
            characters: stats.characters,
            words: stats.words
          }
        }
      }
    })
    this.$refs.toolbarContainer.appendChild(this.editor.ui.view.toolbar.element)

    // Initialize draw.io integration
    this.initDrawioSupport()

    if (this.mode !== 'create') {
      this.editor.setData(this.$store.get('editor/content'))
    }

    this.editor.model.document.on('change:data', _.debounce(evt => {
      this.$store.set('editor/content', beautify(this.editor.getData(), { indent_size: 2, end_with_newline: true }))
    }, 300))

    this.$root.$on('editorInsert', opts => {
      switch (opts.kind) {
        case 'IMAGE':
          this.editor.execute('imageInsert', {
            source: opts.path
          })
          break
        case 'BINARY':
          this.editor.execute('link', opts.path, {
            linkIsDownloadable: true
          })
          break
        case 'DIAGRAM':
          this.editor.execute('imageInsert', {
            source: `data:image/svg+xml;base64,${opts.text}`
          })
          break
      }
    })

    this.$root.$on('editorLinkToPage', opts => {
      this.insertLink()
    })

    // Handle save conflict
    this.$root.$on('saveConflict', () => {
      this.isConflict = true
    })
    this.$root.$on('overwriteEditorContent', () => {
      this.editor.setData(this.$store.get('editor/content'))
    })

    // Handle double-click on diagrams to edit them
    this.editor.editing.view.document.on('dblclick', (evt, data) => {
      const viewElement = data.target
      const modelElement = this.editor.editing.mapper.toModelElement(viewElement)

      if (modelElement && modelElement.name === 'imageBlock') {
        const drawioXml = modelElement.getAttribute('data-drawio-xml')
        if (drawioXml) {
          // Prevent default behavior
          evt.stop()

          // Select the image first
          this.editor.model.change(writer => {
            writer.setSelection(modelElement, 'on')
          })

          // Open draw.io modal with existing XML
          window.dispatchEvent(new CustomEvent('editor:openDrawio', {
            detail: drawioXml
          }))
        }
      }
    }, { priority: 'high' })
  },
  beforeDestroy () {
    if (this.editor) {
      this.editor.destroy()
      this.editor = null
    }
  }
}
</script>

<style lang="scss">

$editor-height: calc(100vh - 64px - 24px);
$editor-height-mobile: calc(100vh - 56px - 16px);

.editor-ckeditor {
  background-color: mc('grey', '200');
  flex: 1 1 50%;
  display: flex;
  flex-flow: column nowrap;
  height: $editor-height;
  max-height: $editor-height;
  position: relative;

  @at-root .theme--dark & {
    background-color: mc('grey', '900');
  }

  @include until($tablet) {
    height: $editor-height-mobile;
    max-height: $editor-height-mobile;
  }

  &-sysbar {
    padding-left: 0;

    &-locale {
      background-color: rgba(255,255,255,.25);
      display:inline-flex;
      padding: 0 12px;
      height: 24px;
      width: 63px;
      justify-content: center;
      align-items: center;
    }
  }

  .contents {
    table {
      margin: inherit;
    }
    pre > code {
      background-color: unset;
      color: unset;
      padding: .15em;
    }
  }

  .ck.ck-toolbar {
    border: none;
    justify-content: center;
    background-color: mc('grey', '300');
    color: #FFF;
  }

  .ck.ck-toolbar__items {
    justify-content: center;
  }

  > .ck-editor__editable {
    background-color: mc('grey', '100');
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2rem;
    box-shadow: 0 0 5px hsla(0, 0, 0, .1);
    margin: 1rem auto 0;
    width: calc(100vw - 256px - 16vw);
    min-height: calc(100vh - 64px - 24px - 1rem - 40px);
    border-radius: 5px;

    @at-root .theme--dark & {
      background-color: #303030;
      color: #FFF;
    }

    @include until($widescreen) {
      width: calc(100vw - 2rem);
      margin: 1rem 1rem 0 1rem;
      min-height: calc(100vh - 64px - 24px - 1rem - 40px);
    }

    @include until($tablet) {
      width: 100%;
      margin: 0;
      min-height: calc(100vh - 56px - 24px - 76px);
    }

    &.ck.ck-editor__editable:not(.ck-editor__nested-editable).ck-focused {
      border-color: #FFF;
      box-shadow: 0 0 10px rgba(mc('blue', '700'), .25);

      @at-root .theme--dark & {
        border-color: #444;
        border-bottom: none;
        box-shadow: 0 0 10px rgba(#000, .25);
      }
    }

    &.ck .ck-editor__nested-editable.ck-editor__nested-editable_focused,
    &.ck .ck-editor__nested-editable:focus,
    .ck-widget.table td.ck-editor__nested-editable.ck-editor__nested-editable_focused,
    .ck-widget.table th.ck-editor__nested-editable.ck-editor__nested-editable_focused {
      background-color: mc('grey', '100');

      @at-root .theme--dark & {
        background-color: mc('grey', '900');
      }
    }
  }
}
</style>
