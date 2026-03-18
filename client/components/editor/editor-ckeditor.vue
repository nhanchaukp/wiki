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
</template>

<script>
import _ from 'lodash'
import { get, sync } from 'vuex-pathify'
import DecoupledEditor from './common/ckeditor'
// import DecoupledEditor from '../../../../wiki-ckeditor5/build/ckeditor'
import EditorConflict from './ckeditor/conflict.vue'
import { html as beautify } from 'js-beautify/js/lib/beautifier.min.js'

/* global siteLangs, WIKI */

export default {
  components: {
    EditorConflict
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
      insertLinkDialog: false,
      editingDiagramBlock: null
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
    insertDiagram () {
      this.activeModal = 'editorModalDrawio'
    },
    handleEditorInsert (opts) {
      if (!this.editor) {
        console.warn('Editor not initialized yet')
        return
      }

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
          // Store diagram as a special comment/marker instead of inserting as image
          // This preserves the original XML data and shows an edit button
          try {
            this.editor.model.change(writer => {
              if (this.editingDiagramBlock) {
                // Update existing diagram block
                const textNode = this.editingDiagramBlock.getChild(0)
                if (textNode) {
                  writer.remove(textNode)
                }
                writer.insertText(opts.text, this.editingDiagramBlock)
                this.editingDiagramBlock = null
              } else {
                // Create new diagram block
                const insertPosition = this.editor.model.document.selection.getFirstPosition()

                // Create a code block for the diagram (similar to markdown)
                const codeBlock = writer.createElement('codeBlock', {
                  language: 'diagram'
                })

                // Insert the base64 XML data as text
                writer.insertText(opts.text, codeBlock)

                // Insert the code block
                writer.insert(codeBlock, insertPosition)

                // Move cursor after the code block
                const newPosition = writer.createPositionAfter(codeBlock)
                writer.setSelection(newPosition)
              }
            })
          } catch (err) {
            console.error('Error inserting diagram:', err)
            this.$store.commit('showNotification', {
              message: 'Failed to insert diagram.',
              style: 'error',
              icon: 'warning'
            })
          }
          break
      }
    },
    setupDiagramBlockRendering () {
      // Override how diagram code blocks are rendered in the editor
      this.editor.conversion.for('editingDowncast').add(dispatcher => {
        dispatcher.on('insert:codeBlock', (evt, data, conversionApi) => {
          const codeBlock = data.item

          // Check if this is a diagram code block
          if (codeBlock.getAttribute('language') === 'diagram') {
            const viewWriter = conversionApi.writer
            const mapper = conversionApi.mapper

            // Prevent default conversion
            evt.stop()

            // Create a custom container for the diagram
            const container = viewWriter.createContainerElement('div', {
              class: 'wiki-diagram-placeholder'
            })

            // Insert the container
            const insertPosition = conversionApi.mapper.toViewPosition(
              conversionApi.model.createPositionBefore(codeBlock)
            )
            viewWriter.insert(insertPosition, container)

            // Map the model element to the view element
            mapper.bindElements(codeBlock, container)

            // Add edit button after DOM is ready
            this.$nextTick(() => {
              const domElement = this.editor.editing.view.domConverter.mapViewToDom(container)
              if (domElement && !domElement.querySelector('.wiki-diagram-edit-btn')) {
                const textNode = codeBlock.getChild(0)
                const diagramData = textNode ? textNode.data : ''

                // Create edit button
                const editBtn = document.createElement('button')
                editBtn.className = 'wiki-diagram-edit-btn'
                editBtn.innerHTML = '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px; margin-right: 4px; vertical-align: text-bottom;"><path d="M3 3v14h14V3H3zm12 12H5V5h10v10z"/><path d="M6 6h3v3H6zm5 0h3v3h-3zm-5 5h3v3H6zm5 0h3v3h-3z"/></svg> Edit Diagram'
                editBtn.type = 'button'
                editBtn.contentEditable = 'false'

                editBtn.addEventListener('click', (e) => {
                  e.preventDefault()
                  e.stopPropagation()

                  try {
                    // Decode and set the data for editing
                    this.$store.set('editor/activeModalData', Buffer.from(diagramData, 'base64').toString())
                    this.activeModal = 'editorModalDrawio'

                    // Store reference to the code block for updating after edit
                    this.editingDiagramBlock = codeBlock
                  } catch (err) {
                    this.$store.commit('showNotification', {
                      message: 'Failed to process diagram data.',
                      style: 'warning',
                      icon: 'warning'
                    })
                  }
                })

                domElement.innerHTML = ''
                domElement.appendChild(editBtn)
              }
            })
          }
        }, { priority: 'high' })
      })

      // For data downcast (when saving), convert diagram code blocks to SVG images
      this.editor.conversion.for('dataDowncast').add(dispatcher => {
        dispatcher.on('insert:codeBlock', (evt, data, conversionApi) => {
          const codeBlock = data.item

          if (codeBlock.getAttribute('language') === 'diagram') {
            const viewWriter = conversionApi.writer

            // Prevent default conversion
            evt.stop()

            const textNode = codeBlock.getChild(0)
            const diagramData = textNode ? textNode.data : ''

            // Create an image element with the SVG data
            const img = viewWriter.createEmptyElement('img', {
              src: `data:image/svg+xml;base64,${diagramData}`,
              class: 'wiki-diagram-image',
              'data-diagram': diagramData
            })

            // Insert the image
            const insertPosition = conversionApi.mapper.toViewPosition(
              conversionApi.model.createPositionBefore(codeBlock)
            )
            viewWriter.insert(insertPosition, img)
          }
        }, { priority: 'high' })
      })
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

    // Add custom rendering for diagram code blocks
    this.setupDiagramBlockRendering()

    // Add Insert Diagram button dynamically after editor is created
    try {
      // Get an existing button to copy its constructor
      const existingButton = this.editor.ui.componentFactory.create('insertAsset')
      if (existingButton && existingButton.constructor) {
        const ButtonView = existingButton.constructor

        // Add the insertDiagram component to the factory
        this.editor.ui.componentFactory.add('insertDiagram', locale => {
          const view = new ButtonView(locale)

          view.set({
            label: 'Insert Diagram',
            icon: '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M3 3v14h14V3H3zm12 12H5V5h10v10z"/><path d="M6 6h3v3H6zm5 0h3v3h-3zm-5 5h3v3H6zm5 0h3v3h-3z"/></svg>',
            tooltip: true
          })

          view.on('execute', () => {
            this.insertDiagram()
          })

          return view
        })

        // Create and add the button to the toolbar
        const diagramButton = this.editor.ui.componentFactory.create('insertDiagram')
        const toolbar = this.editor.ui.view.toolbar

        // Find the position after 'insertAsset' button
        const items = toolbar.items
        const insertAssetIndex = items._items.findIndex(item => {
          return item.label === 'Insert Assets'
        })

        if (insertAssetIndex !== -1) {
          items.add(diagramButton, insertAssetIndex + 1)
        } else {
          items.add(diagramButton)
        }
      }
    } catch (err) {
      console.warn('Could not add Insert Diagram button:', err)
    }

    if (this.mode !== 'create') {
      this.editor.setData(this.$store.get('editor/content'))
    }

    this.editor.model.document.on('change:data', _.debounce(evt => {
      this.$store.set('editor/content', beautify(this.editor.getData(), { indent_size: 2, end_with_newline: true }))
    }, 300))

    // Wait for next tick to ensure editor is fully initialized
    this.$nextTick(() => {
      this.$root.$on('editorInsert', this.handleEditorInsert)
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
  },
  beforeDestroy () {
    this.$root.$off('editorInsert', this.handleEditorInsert)
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

  // Diagram placeholder styling
  .wiki-diagram-placeholder {
    position: relative;
    border: 2px dashed mc('blue', '400');
    border-radius: 8px;
    padding: 2rem;
    margin: 1.5rem 0;
    background: linear-gradient(135deg, mc('blue', '50') 0%, mc('indigo', '50') 100%);
    text-align: center;
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;

    @at-root .theme--dark & {
      background: linear-gradient(135deg, rgba(mc('blue', '700'), 0.15) 0%, rgba(mc('indigo', '700'), 0.15) 100%);
      border-color: mc('blue', '600');
    }

    &::before {
      content: 'Draw.io Diagram';
      position: absolute;
      top: 0.5rem;
      left: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: mc('blue', '600');
      opacity: 0.8;

      @at-root .theme--dark & {
        color: mc('blue', '300');
      }
    }
  }

  .wiki-diagram-edit-btn {
    display: inline-flex;
    align-items: center;
    padding: 0.75rem 1.5rem;
    background-color: mc('blue', '500');
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 600;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

    &:hover {
      background-color: mc('blue', '600');
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }

    &:active {
      background-color: mc('blue', '700');
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      transform: translateY(0);
    }

    @at-root .theme--dark & {
      background-color: mc('blue', '600');

      &:hover {
        background-color: mc('blue', '500');
      }

      &:active {
        background-color: mc('blue', '400');
      }
    }

    svg {
      fill: currentColor;
    }
  }
}
</style>
