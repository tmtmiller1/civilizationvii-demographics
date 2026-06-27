class Panel {
  constructor() {
    this.Root = {
      classList: {
        add: () => {},
        remove: () => {}
      },
      setAttribute: () => {},
      querySelector: () => null
    };
  }

  onInitialize() {}

  onAttach() {}

  onDetach() {}

  onLoseFocus() {}

  onReceiveFocus() {}

  close() {}
}

export default Panel;
