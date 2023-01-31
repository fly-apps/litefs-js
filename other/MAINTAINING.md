# Maintaining

This is documentation for maintainers of this project.

## Pull Requests

As a maintainer, you're fine to make your branches on the main repo or on your
own fork. Either way is fine.

When we receive a pull request, a GitHub Action is kicked off automatically (see
the `.github/workflows/validate.yml` for what runs in the Action). We avoid
merging anything that breaks the GitHub Action.

Please review PRs and focus on the code rather than the individual. You never
know when this is someone's first ever PR and we want their experience to be as
positive as possible, so be uplifting and constructive.

When you merge the pull request, 99% of the time you should use the
[Squash and merge](https://help.github.com/articles/merging-a-pull-request/)
feature. This keeps our git history clean, but more importantly, this allows us
to make any necessary changes to the commit message so we release what we want
to release. See the next section on Releases for more about that.

## Release

Our releases are automatic. They happen whenever code lands into `main`. A
GitHub Action gets kicked off and if it's successful, a tool called
[`semantic-release`](https://github.com/semantic-release/semantic-release) is
used to automatically publish a new release to npm as well as a changelog to
GitHub. It is only able to determine the version and whether a release is
necessary by the git commit messages. With this in mind, **please brush up on
[the commit message convention][commit] which drives our releases.**

> One important note about this: Please make sure that commit messages do NOT
> contain the words "BREAKING CHANGE" in them unless we want to push a major
> version. I've been burned by this more than once where someone will include
> "BREAKING CHANGE: None" and it will end up releasing a new major version. Not
> a huge deal honestly, but kind of annoying...

## Thanks!

Thank you so much for helping to maintain this project!

<!-- prettier-ignore-start -->
[commit]: https://github.com/conventional-changelog-archived-repos/conventional-changelog-angular/blob/ed32559941719a130bb0327f886d6a32a8cbc2ba/convention.md
<!-- prettier-ignore-end -->
