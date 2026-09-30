<script>
  import { onMount } from 'svelte'
  import { verdictCategories, loadVerdictCategories, addVerdictCategory, deleteVerdictCategory } from './verdictCategories.svelte.js'

  onMount(() => { void loadVerdictCategories() })

  let value = $state('')
  let symbol = $state('')
  let title = $state('')
  let color = $state('#5a5aa8')
  let adding = $state(false)
  let addError = $state(null)
  let deletingValue = $state(null)
  let deleteError = $state(null)

  async function submit(event) {
    event.preventDefault()
    adding = true
    addError = null
    try {
      await addVerdictCategory({ value: value.trim().toLowerCase(), symbol, title, color })
      value = ''
      symbol = ''
      title = ''
      color = '#5a5aa8'
    } catch (err) {
      addError = err.message
    } finally {
      adding = false
    }
  }

  async function remove(category) {
    deletingValue = category.value
    deleteError = null
    try {
      await deleteVerdictCategory(category.value)
    } catch (err) {
      deleteError = err.message
    } finally {
      deletingValue = null
    }
  }
</script>

<section class="verdict-settings">
  <h2>Verdict categories</h2>
  <p class="hint">
    The grades available when manually reviewing an answer. Built-in categories can't be removed;
    anything you add here shows up immediately in every question's grading row.
  </p>

  {#if verdictCategories.error}<p class="error">{verdictCategories.error}</p>{/if}
  {#if deleteError}<p class="error">{deleteError}</p>{/if}

  <ul class="list">
    {#each verdictCategories.items as category (category.value)}
      <li>
        <span class="swatch" style="background: {category.color}">{category.symbol}</span>
        <span class="title">{category.title}</span>
        <code class="value">{category.value}</code>
        {#if category.builtin}
          <span class="builtin-tag">built in</span>
        {:else}
          <button type="button" class="link" disabled={deletingValue === category.value} onclick={() => remove(category)}>
            {deletingValue === category.value ? 'Removing…' : 'Remove'}
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <form onsubmit={submit}>
    <h3>Add a category</h3>
    {#if addError}<p class="error">{addError}</p>{/if}
    <div class="fields">
      <label>
        Symbol
        <input type="text" bind:value={symbol} maxlength="2" placeholder="⏳" required />
      </label>
      <label>
        Title
        <input type="text" bind:value={title} placeholder="Outdated" required />
      </label>
      <label>
        Value (used in exports, not shown)
        <input type="text" bind:value={value} placeholder="outdated" pattern="[a-z][a-z0-9_]*" required />
      </label>
      <label>
        Color
        <input type="color" bind:value={color} />
      </label>
      <button type="submit" class="primary" disabled={adding}>{adding ? 'Adding…' : 'Add category'}</button>
    </div>
  </form>
</section>

<style>
  .verdict-settings { max-width: 640px; margin-bottom: 2rem; }
  h2 { font-size: 1rem; margin: 0 0 0.4rem; }
  h3 { font-size: 0.85rem; margin: 1.2rem 0 0.6rem; }
  .hint { font-size: 0.8rem; color: var(--muted); line-height: 1.5; }
  .error { font-size: 0.8rem; color: var(--danger); }

  .list { list-style: none; margin: 0.8rem 0; padding: 0; }
  .list li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.85rem;
  }
  .swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    color: #fff;
    font-size: 0.85rem;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .title { flex: 1; }
  .value { font-size: 0.72rem; color: var(--muted); }
  .builtin-tag {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .link {
    font: inherit;
    font-size: 0.78rem;
    color: var(--muted);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .link:hover { color: var(--danger); text-decoration: underline; }

  .fields { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.75rem; color: var(--muted); }
  input[type='text'] { font: inherit; padding: 0.35rem 0.5rem; border: 1px solid var(--line); background: var(--card); color: var(--text); }
  input[type='color'] { width: 2.4rem; height: 2.1rem; padding: 0; border: 1px solid var(--line); background: var(--card); }
  .primary { padding: 0.45rem 0.9rem; font: inherit; font-size: 0.85rem; background: var(--accent); color: #fff; border: 0; cursor: pointer; }
  .primary:disabled { opacity: 0.6; cursor: default; }
</style>
