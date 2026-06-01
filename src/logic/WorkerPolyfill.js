if (typeof self.localStorage === 'undefined') {
  self.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}
if (typeof self.navigator === 'undefined') {
  self.navigator = { languages: ['zh'] };
} else if (!self.navigator.languages) {
  self.navigator.languages = ['zh'];
}
if (typeof self.process === 'undefined') {
  self.process = { env: { NODE_ENV: 'production' } };
}
if (typeof self.document === 'undefined') {
  const mockElement = () => {
    const el = {
      appendChild: (child) => child,
      setAttribute: () => {},
      addEventListener: () => {},
      style: {},
      dataset: {},
      classList: { add: () => {}, remove: () => {} },
      textContent: '',
      innerHTML: '',
      className: '',
      remove: () => {},
      querySelectorAll: () => [],
      querySelector: () => null,
      children: [],
      childNodes: [],
    };
    return el;
  };
  self.document = {
    title: '',
    querySelectorAll: () => [],
    createElement: () => mockElement(),
    createTextNode: (text) => ({ textContent: text }),
    createDocumentFragment: () => mockElement(),
  };
}
