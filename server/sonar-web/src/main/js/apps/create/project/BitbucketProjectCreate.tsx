/*
 * SonarQube
 * Copyright (C) 2009-2021 SonarSource SA
 * mailto:info AT sonarsource DOT com
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */
import * as React from 'react';
import { WithRouterProps } from 'react-router';
import {
  checkPersonalAccessTokenIsValid,
  getBitbucketServerProjects,
  getBitbucketServerRepositories,
  importBitbucketServerProject,
  searchForBitbucketServerRepositories,
  setAlmPersonalAccessToken
} from '../../../api/alm-integrations';
import {
  BitbucketProject,
  BitbucketProjectRepositories,
  BitbucketRepository
} from '../../../types/alm-integration';
import { AlmSettingsInstance } from '../../../types/alm-settings';
import BitbucketCreateProjectRenderer from './BitbucketProjectCreateRenderer';
import { DEFAULT_BBS_PAGE_SIZE } from './constants';

interface Props extends Pick<WithRouterProps, 'location'> {
  canAdmin: boolean;
  bitbucketSettings: AlmSettingsInstance[];
  loadingBindings: boolean;
  onProjectCreate: (projectKeys: string[]) => void;
}

interface State {
  bitbucketSetting?: AlmSettingsInstance;
  importing: boolean;
  loading: boolean;
  patIsValid?: boolean;
  projects?: BitbucketProject[];
  projectRepositories?: BitbucketProjectRepositories;
  searching: boolean;
  searchResults?: BitbucketRepository[];
  selectedRepository?: BitbucketRepository;
  submittingToken?: boolean;
  tokenValidationFailed: boolean;
}

export default class BitbucketProjectCreate extends React.PureComponent<Props, State> {
  mounted = false;

  constructor(props: Props) {
    super(props);
    this.state = {
      // For now, we only handle a single instance. So we always use the first
      // one from the list.
      bitbucketSetting: props.bitbucketSettings[0],
      importing: false,
      loading: false,
      searching: false,
      tokenValidationFailed: false
    };
  }

  componentDidMount() {
    this.mounted = true;
    this.fetchInitialData();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.bitbucketSettings.length === 0 && this.props.bitbucketSettings.length > 0) {
      this.setState({ bitbucketSetting: this.props.bitbucketSettings[0] }, () =>
        this.fetchInitialData()
      );
    }
  }

  componentWillUnmount() {
    this.mounted = false;
  }

  fetchInitialData = async () => {
    this.setState({ loading: true });

    const patIsValid = await this.checkPersonalAccessToken().catch(() => false);

    let projects;
    if (patIsValid) {
      projects = await this.fetchBitbucketProjects().catch(() => undefined);
    }

    let projectRepositories;
    if (projects && projects.length > 0) {
      projectRepositories = await this.fetchBitbucketRepositories(projects).catch(() => undefined);
    }

    if (this.mounted) {
      this.setState({
        patIsValid,
        projects,
        projectRepositories,
        loading: false
      });
    }
  };

  checkPersonalAccessToken = () => {
    const { bitbucketSetting } = this.state;

    if (!bitbucketSetting) {
      return Promise.resolve(false);
    }

    return checkPersonalAccessTokenIsValid(bitbucketSetting.key).then(({ status }) => status);
  };

  fetchBitbucketProjects = (): Promise<BitbucketProject[] | undefined> => {
    const { bitbucketSetting } = this.state;

    if (!bitbucketSetting) {
      return Promise.resolve(undefined);
    }

    return getBitbucketServerProjects(bitbucketSetting.key).then(({ projects }) => projects);
  };

  fetchBitbucketRepositories = (
    projects: BitbucketProject[]
  ): Promise<BitbucketProjectRepositories | undefined> => {
    const { bitbucketSetting } = this.state;

    if (!bitbucketSetting) {
      return Promise.resolve(undefined);
    }

    return Promise.all(
      projects.map(p => {
        return getBitbucketServerRepositories(bitbucketSetting.key, p.name).then(
          ({ isLastPage, repositories }) => {
            // Because the WS uses the project name rather than its key to find
            // repositories, we can match more repositories than we expect. For
            // example, p.name = "A1" would find repositories for projects "A1",
            // "A10", "A11", etc. This is a limitation of BBS. To make sure we
            // don't display incorrect information, filter on the project key.
            const filteredRepositories = repositories.filter(r => r.projectKey === p.key);

            // And because of the above, the "isLastPage" cannot be relied upon
            // either. This one is impossible to get 100% for now. We can only
            // make some assumptions: by default, the page size for BBS is 25
            // (this is not part of the payload, so we don't know the actual
            // number; but changing this implies changing some advanced config,
            // so it's not likely). If the filtered repos is larger than this
            // number AND isLastPage is false, we'll keep it at false.
            // Otherwise, we assume it's true.
            const realIsLastPage =
              isLastPage || filteredRepositories.length < DEFAULT_BBS_PAGE_SIZE;

            return {
              repositories: filteredRepositories,
              isLastPage: realIsLastPage,
              projectKey: p.key
            };
          }
        );
      })
    ).then(results => {
      return results.reduce(
        (acc: BitbucketProjectRepositories, { isLastPage, projectKey, repositories }) => {
          return { ...acc, [projectKey]: { allShown: isLastPage, repositories } };
        },
        {}
      );
    });
  };

  handlePersonalAccessTokenCreate = (token: string) => {
    const { bitbucketSetting } = this.state;

    if (!bitbucketSetting || token.length < 1) {
      return;
    }

    this.setState({ submittingToken: true, tokenValidationFailed: false });
    setAlmPersonalAccessToken(bitbucketSetting.key, token)
      .then(this.checkPersonalAccessToken)
      .then(patIsValid => {
        if (this.mounted) {
          this.setState({ submittingToken: false, patIsValid, tokenValidationFailed: !patIsValid });
          if (patIsValid) {
            this.fetchInitialData();
          }
        }
      })
      .catch(() => {
        if (this.mounted) {
          this.setState({ submittingToken: false });
        }
      });
  };

  handleImportRepository = () => {
    const { bitbucketSetting, selectedRepository } = this.state;

    if (!bitbucketSetting || !selectedRepository) {
      return;
    }

    this.setState({ importing: true });
    importBitbucketServerProject(
      bitbucketSetting.key,
      selectedRepository.projectKey,
      selectedRepository.slug
    )
      .then(({ project: { key } }) => {
        if (this.mounted) {
          this.setState({ importing: false });
          this.props.onProjectCreate([key]);
        }
      })
      .catch(() => {
        if (this.mounted) {
          this.setState({ importing: false });
        }
      });
  };

  handleSearch = (query: string) => {
    const { bitbucketSetting } = this.state;

    if (!bitbucketSetting) {
      return;
    }

    if (!query) {
      this.setState({ searching: false, searchResults: undefined, selectedRepository: undefined });
      return;
    }

    this.setState({ searching: true, selectedRepository: undefined });
    searchForBitbucketServerRepositories(bitbucketSetting.key, query)
      .then(({ repositories }) => {
        if (this.mounted) {
          this.setState({ searching: false, searchResults: repositories });
        }
      })
      .catch(() => {
        if (this.mounted) {
          this.setState({ searching: false });
        }
      });
  };

  handleSelectRepository = (selectedRepository: BitbucketRepository) => {
    this.setState({ selectedRepository });
  };

  render() {
    const { canAdmin, loadingBindings, location } = this.props;
    const {
      bitbucketSetting,
      importing,
      loading,
      patIsValid,
      projectRepositories,
      projects,
      searching,
      searchResults,
      selectedRepository,
      submittingToken,
      tokenValidationFailed
    } = this.state;

    return (
      <BitbucketCreateProjectRenderer
        bitbucketSetting={bitbucketSetting}
        canAdmin={canAdmin}
        importing={importing}
        loading={loading || loadingBindings}
        onImportRepository={this.handleImportRepository}
        onPersonalAccessTokenCreate={this.handlePersonalAccessTokenCreate}
        onProjectCreate={this.props.onProjectCreate}
        onSearch={this.handleSearch}
        onSelectRepository={this.handleSelectRepository}
        projectRepositories={projectRepositories}
        projects={projects}
        searchResults={searchResults}
        searching={searching}
        selectedRepository={selectedRepository}
        showPersonalAccessTokenForm={!patIsValid || Boolean(location.query.resetPat)}
        submittingToken={submittingToken}
        tokenValidationFailed={tokenValidationFailed}
      />
    );
  }
}
