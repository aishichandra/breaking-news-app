// Exclude bad questions without deleting records or shifting stored indexes.
export function activeArticles(articles) {
  return articles.map(article=>({...article,questions:(article.questions??[])
    .map((question,index)=>({...question,question_index:question.question_index??index}))
    .filter(question=>!question.flagged)
  })).filter(article=>article.questions.length)
}
export function activeDataset(articles,answers) {
  const active=activeArticles(articles)
  const questionIds=new Set(active.flatMap(article=>article.questions.map(q=>String(q.question_id))))
  return {articles:active,answers:answers.filter(answer=>questionIds.has(String(answer.question_id)))}
}
