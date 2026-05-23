from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass(frozen=True)
class CrawlPage:
    url: str
    markdown: str
    success: bool
    error: str | None = None


async def crawl_url_async(url: str, *, check_robots_txt: bool = True) -> CrawlPage:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

    browser_config = BrowserConfig(headless=True, verbose=False)
    run_config = CrawlerRunConfig(check_robots_txt=check_robots_txt)

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)
        if not result.success:
            return CrawlPage(
                url=url,
                markdown="",
                success=False,
                error=result.error_message or "crawl failed",
            )
        markdown = (result.markdown or "").strip()
        return CrawlPage(url=url, markdown=markdown, success=True)


def crawl_url(url: str, *, check_robots_txt: bool = True) -> CrawlPage:
    return asyncio.run(crawl_url_async(url, check_robots_txt=check_robots_txt))
