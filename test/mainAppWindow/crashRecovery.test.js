const { handleRenderProcessGone } = require('../../app/mainAppWindow/helpers');

describe('handleRenderProcessGone', () => {
  it('calls reload on crashed renderer', () => {
    const reload = jest.fn();
    handleRenderProcessGone({ reason: 'crashed' }, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('calls reload on killed renderer', () => {
    const reload = jest.fn();
    handleRenderProcessGone({ reason: 'killed' }, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('calls reload on oom', () => {
    const reload = jest.fn();
    handleRenderProcessGone({ reason: 'oom' }, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not call reload on clean exit', () => {
    const reload = jest.fn();
    handleRenderProcessGone({ reason: 'clean-exit' }, reload);
    expect(reload).not.toHaveBeenCalled();
  });
});
