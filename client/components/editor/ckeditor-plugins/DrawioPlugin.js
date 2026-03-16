/**
 * Drawio Plugin for CKEditor 5
 *
 * This plugin is designed to work with a pre-built CKEditor instance
 */
export default function DrawioPlugin (editor) {
  // Extend schema to support data-drawio-xml attribute on images
  editor.model.schema.extend('imageBlock', {
    allowAttributes: ['data-drawio-xml']
  })

  // Conversion from model to view (editing and data)
  editor.conversion.for('downcast').add(dispatcher => {
    dispatcher.on('attribute:data-drawio-xml:imageBlock', (evt, data, conversionApi) => {
      const viewWriter = conversionApi.writer
      const viewElement = conversionApi.mapper.toViewElement(data.item)

      if (data.attributeNewValue !== null) {
        viewWriter.setAttribute('data-drawio-xml', data.attributeNewValue, viewElement)
      } else {
        viewWriter.removeAttribute('data-drawio-xml', viewElement)
      }
    })
  })

  // Conversion from view to model (data loading)
  editor.conversion.for('upcast').attributeToAttribute({
    view: 'data-drawio-xml',
    model: 'data-drawio-xml'
  })

  // Define the command
  editor.commands.add('insertDiagram', {
    execute (options = {}) {
      const model = editor.model

      // If we have SVG data, insert or update the diagram
      if (options.svg && options.xml) {
        model.change(writer => {
          const selection = model.document.selection
          const selectedElement = selection.getSelectedElement()

          // Check if we're editing an existing diagram
          if (selectedElement && selectedElement.name === 'imageBlock' && selectedElement.getAttribute('data-drawio-xml')) {
            // Update existing diagram
            writer.setAttribute('src', options.svg, selectedElement)
            writer.setAttribute('data-drawio-xml', options.xml, selectedElement)
          } else {
            // Create new diagram
            const imageElement = writer.createElement('imageBlock', {
              src: options.svg,
              'data-drawio-xml': options.xml
            })

            model.insertContent(imageElement, selection)
          }
        })
      } else {
        // Trigger the modal to open
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('editor:openDrawio', {
            detail: options.xml || null
          }))
        }
      }
    },

    refresh () {
      const model = editor.model
      const selection = model.document.selection
      const allowedIn = model.schema.findAllowedParent(selection.getFirstPosition(), 'imageBlock')

      this.isEnabled = allowedIn !== null
    }
  })

  // Add button to toolbar
  editor.ui.componentFactory.add('insertDiagram', locale => {
    const command = editor.commands.get('insertDiagram')
    const button = new editor.ui.componentFactory.constructor.prototype.constructor.ButtonView(locale)

    button.set({
      label: 'Insert Diagram',
      withText: false,
      tooltip: true,
      icon: `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 6v3h4V6H3zm0 4v3h4v-3H3zm0 4v3h4v-3H3zm5 3h4v-3H8v3zm5 0h4v-3h-4v3zm4-4v-3h-4v3h4zm0-4V6h-4v3h4zm1.5 8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 17V4c.222-.863 1.068-1.5 2-1.5h13c.932 0 1.778.637 2 1.5v13zM12 13v-3H8v3h4zm0-4V6H8v3h4z"/>
      </svg>`
    })

    button.bind('isEnabled').to(command, 'isEnabled')
    button.on('execute', () => {
      editor.execute('insertDiagram')
    })

    return button
  })
}
