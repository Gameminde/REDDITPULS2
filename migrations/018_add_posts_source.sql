-- Add explicit raw source tracking for scraper audits.
alter table public.posts
    add column if not exists source text;

update public.posts
set source = case
    when id like 'reddit\_%' escape '\' then 'reddit'
    when id like 'reddit_comment\_%' escape '\' then 'reddit_comment'
    when id like 'hackernews\_%' escape '\' then 'hackernews'
    when id like 'producthunt\_%' escape '\' then 'producthunt'
    when id like 'indiehackers\_%' escape '\' then 'indiehackers'
    when id like 'stackoverflow\_%' escape '\' then 'stackoverflow'
    when id like 'githubissues\_%' escape '\' then 'githubissues'
    when id like 'g2_review\_%' escape '\' then 'g2_review'
    when id like 'job_posting\_%' escape '\' then 'job_posting'
    when id like 'vendor_blog\_%' escape '\' then 'vendor_blog'
    else source
end
where coalesce(source, '') = '';

create index if not exists idx_posts_source on public.posts(source);
